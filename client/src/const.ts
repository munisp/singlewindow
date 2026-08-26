// The deployment must provide the Keycloak authorization/login URL. It may include
// provider-specific query parameters; callers can request a relative return path.
export const getLoginUrl = (returnPath?: string) => {
  const configuredLoginUrl = import.meta.env.VITE_KEYCLOAK_LOGIN_URL;
  if (!configuredLoginUrl) {
    throw new Error("VITE_KEYCLOAK_LOGIN_URL must be configured for interactive login.");
  }

  const url = new URL(configuredLoginUrl, window.location.origin);
  const safeReturnPath = returnPath && returnPath.startsWith("/") && !returnPath.startsWith("//")
    ? returnPath
    : "/";
  url.searchParams.set("return_path", safeReturnPath);
  return url.toString();
};
