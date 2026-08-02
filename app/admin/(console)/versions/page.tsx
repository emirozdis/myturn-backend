import { ExternalLinkIcon, SmartphoneIcon } from "lucide-react";

import { PageHeader } from "@/app/admin/_components/admin-shell";
import { VersionRequirementDialog } from "@/components/admin/version-requirement-dialog";
import { Badge } from "@/components/ui/badge";
import { getAppVersionRequirements } from "@/lib/admin-data";
import { formatDate } from "@/lib/admin-format";

export const dynamic = "force-dynamic";

const platforms = ["ios", "android"] as const;
const releaseChannels = ["development", "preview", "production"] as const;

export default async function AdminVersionsPage({ searchParams }: {
  searchParams: Promise<{ updated?: string }>;
}) {
  const requirements = await getAppVersionRequirements();
  const { updated } = await searchParams;
  const requirementByKey = new Map(requirements.map((requirement) => [
    `${requirement.platform}:${requirement.releaseChannel}`,
    requirement,
  ]));

  return (
    <>
      <PageHeader
        eyebrow="Mobile releases"
        title="Version requirements"
        description="Control the minimum app version and native build allowed to proceed past launch for every platform and release channel."
      />

      {updated ? <div className="version-policy-success" role="status">Version requirement updated. The launch-check cache was refreshed immediately.</div> : null}

      <section className="version-policy-summary admin-panel">
        <div><SmartphoneIcon /><span><strong>Both checks are enforced</strong><small>A client must meet the minimum semantic version and minimum native build number.</small></span></div>
        <p>Changes affect the next request to <code>/api/app/version</code>. Production requirements can block installed builds, so every save includes a separate review and confirmation.</p>
      </section>

      <div className="version-platform-list">
        {platforms.map((platform) => (
          <section key={platform} className="version-platform-section">
            <header><div><p>{platform === "ios" ? "Apple" : "Google Play"}</p><h2>{platform === "ios" ? "iOS" : "Android"}</h2></div><Badge variant="outline">3 release channels</Badge></header>
            <div className="version-policy-grid">
              {releaseChannels.map((releaseChannel) => {
                const requirement = requirementByKey.get(`${platform}:${releaseChannel}`) ?? null;
                return (
                  <article key={releaseChannel} className="admin-panel version-policy-card">
                    <div className="version-policy-card-top">
                      <div><span className="version-channel-dot" /><strong>{releaseChannel}</strong></div>
                      <Badge variant={requirement ? "outline" : "secondary"}>{requirement ? "Configured" : "Missing"}</Badge>
                    </div>
                    <dl>
                      <div><dt>Minimum version</dt><dd>{requirement?.minimumVersion ?? "Not configured"}</dd></div>
                      <div><dt>Minimum build</dt><dd>{requirement?.minimumBuildNumber ?? "—"}</dd></div>
                      <div className="version-policy-url"><dt>Update destination</dt><dd>{requirement ? <a href={requirement.updateUrl} target="_blank" rel="noreferrer">{requirement.updateUrl}<ExternalLinkIcon /></a> : "The API currently fails closed for this audience."}</dd></div>
                    </dl>
                    <footer>
                      <span>{requirement ? `Updated ${formatDate(requirement.updatedAt)}` : "Create this policy before distributing the client."}</span>
                      <VersionRequirementDialog
                        key={`${platform}-${releaseChannel}-${requirement?.updatedAt.toISOString() ?? "missing"}`}
                        platform={platform}
                        releaseChannel={releaseChannel}
                        requirement={requirement ? {
                          minimumVersion: requirement.minimumVersion,
                          minimumBuildNumber: requirement.minimumBuildNumber,
                          updateUrl: requirement.updateUrl,
                        } : null}
                      />
                    </footer>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
