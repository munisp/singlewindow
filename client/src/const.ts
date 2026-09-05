// The deployment must provide the Keycloak authorization/login URL. It may include
// provider-specific query parameters; callers can request a relative return path.
export const getLoginUrl = (returnPath?: string) => {
  const configuredLoginUrl = import.meta.env.VITE_KEYCLOAK_LOGIN_URL;
  if (!configuredLoginUrl) {
    // Demo deployments run without Keycloak (DEMO_MODE=true on the server,
    // surfaced to the client as VITE_DEMO_MODE). Route interactive logins to
    // the local demo persona picker instead of crashing every render path
    // that links to "Sign In". Production stays fail-fast.
    if (import.meta.env.VITE_DEMO_MODE === "true") {
      const safeDemoReturn =
        returnPath && returnPath.startsWith("/") && !returnPath.startsWith("//")
          ? returnPath
          : "/";
      return `/demo?return_path=${encodeURIComponent(safeDemoReturn)}`;
    }
    throw new Error("VITE_KEYCLOAK_LOGIN_URL must be configured for interactive login.");
  }

  const url = new URL(configuredLoginUrl, window.location.origin);
  const safeReturnPath = returnPath && returnPath.startsWith("/") && !returnPath.startsWith("//")
    ? returnPath
    : "/";
  url.searchParams.set("return_path", safeReturnPath);
  return url.toString();
};
