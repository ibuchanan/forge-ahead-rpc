const unauthorized = { kind: "unauthorized" as const };
const unavailable = { kind: "unavailable" as const };

function validBasicAuthorization(authorization: string): boolean {
  if (!/^Basic [A-Za-z0-9+/]+={0,2}$/.test(authorization)) return false;
  const encoded = authorization.slice(6);
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.toString("base64") !== encoded) return false;
  const credentials = decoded.toString("utf8");
  return (
    Buffer.from(credentials, "utf8").compare(decoded) === 0 &&
    /^[^\s:@]+@[^\s:@]+\.[^\s:@]+:[^\r\n]+(?![\s\S])/.test(credentials)
  );
}

function trustedSiteOrigin(jiraSiteUrl: string): string | undefined {
  const site = new URL(jiraSiteUrl);
  if (
    site.protocol !== "https:" ||
    !site.hostname ||
    site.username ||
    site.password ||
    site.port ||
    site.pathname !== "/" ||
    site.search ||
    site.hash
  )
    return undefined;
  return site.origin;
}

function requestFailure(status: number) {
  if (status === 401 || status === 403) return unauthorized;
  if (status !== 200) return unavailable;
  return undefined;
}

/** Internal-use Jira admin verifier. The caller provides a Jira HTTP port; do not use for distributable apps. */
export function createJiraAdminAuthenticator(
  requestJira: (
    url: string,
    authorization: string,
  ) => Promise<{ status: number; body: unknown }>,
) {
  return async (
    authorization: string,
    installation: { jiraSiteUrl: string },
  ) => {
    if (!validBasicAuthorization(authorization)) return unauthorized;
    try {
      const origin = trustedSiteOrigin(installation.jiraSiteUrl);
      if (!origin) return unavailable;
      const myself = await requestJira(
        `${origin}/rest/api/3/myself`,
        authorization,
      );
      const myselfFailure = requestFailure(myself.status);
      if (myselfFailure) return myselfFailure;
      const accountId = (myself.body as { accountId?: unknown } | null)
        ?.accountId;
      if (typeof accountId !== "string" || !accountId) return unavailable;
      const permissions = await requestJira(
        `${origin}/rest/api/3/mypermissions?permissions=ADMINISTER`,
        authorization,
      );
      const permissionsFailure = requestFailure(permissions.status);
      if (permissionsFailure) return permissionsFailure;
      const admin = (
        permissions.body as {
          permissions?: { ADMINISTER?: { havePermission?: unknown } };
        } | null
      )?.permissions?.ADMINISTER?.havePermission;
      if (admin !== true && admin !== false) return unavailable;
      return admin
        ? { kind: "authenticated" as const, principal: { accountId } }
        : { kind: "forbidden" as const };
    } catch {
      return unavailable;
    }
  };
}
