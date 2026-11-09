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
    if (!/^Basic [A-Za-z0-9+/]+={0,2}$/.test(authorization))
      return { kind: "unauthorized" as const };
    const decoded = Buffer.from(authorization.slice(6), "base64");
    if (decoded.toString("base64") !== authorization.slice(6))
      return { kind: "unauthorized" as const };
    const credentials = decoded.toString("utf8");
    const separator = credentials.indexOf(":");
    if (
      Buffer.from(credentials, "utf8").compare(decoded) !== 0 ||
      separator < 1 ||
      separator === credentials.length - 1 ||
      !/^[^\s:@]+@[^\s:@]+\.[^\s:@]+$/.test(credentials.slice(0, separator)) ||
      /[\r\n]/.test(credentials)
    )
      return { kind: "unauthorized" as const };
    try {
      const site = new URL(installation.jiraSiteUrl);
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
        return { kind: "unavailable" as const };
      const myself = await requestJira(
        `${site.origin}/rest/api/3/myself`,
        authorization,
      );
      if (myself.status === 401 || myself.status === 403)
        return { kind: "unauthorized" as const };
      if (myself.status !== 200) return { kind: "unavailable" as const };
      const accountId = (myself.body as { accountId?: unknown } | null)
        ?.accountId;
      if (typeof accountId !== "string" || !accountId)
        return { kind: "unavailable" as const };
      const permissions = await requestJira(
        `${site.origin}/rest/api/3/mypermissions?permissions=ADMINISTER`,
        authorization,
      );
      if (permissions.status === 401 || permissions.status === 403)
        return { kind: "unauthorized" as const };
      if (permissions.status !== 200) return { kind: "unavailable" as const };
      const admin = (
        permissions.body as {
          permissions?: { ADMINISTER?: { havePermission?: unknown } };
        } | null
      )?.permissions?.ADMINISTER?.havePermission;
      if (admin !== true && admin !== false)
        return { kind: "unavailable" as const };
      return admin
        ? { kind: "authenticated" as const, principal: { accountId } }
        : { kind: "forbidden" as const };
    } catch {
      return { kind: "unavailable" as const };
    }
  };
}
