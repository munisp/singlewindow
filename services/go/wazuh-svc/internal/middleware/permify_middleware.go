// permify_middleware.go — fail-closed HTTP authorization middleware for wazuh-svc.
//
// P0 remediation (independent audit): Permify check errors previously failed
// OPEN (implicit allow). This middleware enforces fail-closed semantics:
//   - Permify unreachable / non-200 / decode error → 503 Service Unavailable
//   - CHECK_RESULT_DENIED                            → 403 Forbidden
//   - CHECK_RESULT_ALLOWED                           → request proceeds
package middleware

import (
	"net/http"
)

// IdentityExtractor pulls the user ID and entity ID for the permission check
// out of the incoming request (e.g. from a validated JWT claim and a path
// parameter). Returning an empty userID rejects the request with 401.
type IdentityExtractor func(r *http.Request) (userID, entityID string)

// RequirePermission returns middleware that checks (userID, permission,
// entityType:entityID) against Permify for every request. It never fails open.
func (p *PermifyClient) RequirePermission(entityType, permission string, extract IdentityExtractor) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userID, entityID := extract(r)
			if userID == "" {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}
			allowed, err := p.CheckAuditPermission(r.Context(), userID, entityID, permission)
			if err != nil {
				p.logger.Error("permify enforcement unavailable (fail-closed 503)", "error", err)
				http.Error(w, `{"error":"authorization service unavailable"}`, http.StatusServiceUnavailable)
				return
			}
			if !allowed {
				http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
