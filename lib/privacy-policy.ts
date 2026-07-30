export const PRIVACY_POLICY_VERSION = "1.3";
export const PRIVACY_POLICY_EFFECTIVE_DATE = "July 17, 2026";
export const PRIVACY_POLICY_EFFECTIVE_AT = "2026-07-17T00:00:00.000Z";
export const PRIVACY_CONTACT_EMAIL = "support@myturn.emirozdis.tr";
export const PRIVACY_POLICY_URL = "https://myturn.emirozdis.tr/privacy";
export const TERMS_URL = "https://myturn.emirozdis.tr/terms";
export const SUPPORT_URL = "https://myturn.emirozdis.tr/support";
export const ACCOUNT_DELETION_URL = "https://myturn.emirozdis.tr/account";

export interface PrivacyPolicySection {
  id: string;
  title: string;
  paragraphs?: readonly string[];
  items?: readonly string[];
}

export const SERVICE_PROVIDERS = [
  {
    provider: "Vercel and PostgreSQL/Supabase infrastructure",
    purpose: "Next.js API hosting, databases, authentication records, and service operations.",
    data: "Account, profile, group, activity, technical, and transaction-related records processed by the API.",
  },
  {
    provider: "Cloudflare (R2 and Workers)",
    purpose: "Hot media storage, signed media delivery, network security, and edge processing.",
    data: "Uploaded media, media keys, request details, IP address, and security/delivery logs.",
  },
  {
    provider: "Backblaze (B2)",
    purpose: "Cold archive storage for older media.",
    data: "Archived videos, photos, thumbnails, and related storage metadata.",
  },
  {
    provider: "Google Firebase",
    purpose: "App Check, Analytics, Crashlytics, and Cloud Messaging.",
    data: "App/device identifiers, attestation signals, notification tokens, screen and feature events, user ID, diagnostics, crash logs, and notification delivery data.",
  },
  {
    provider: "Brevo",
    purpose: "Transactional email such as verification and password-reset messages.",
    data: "Email address, display name, message content, and delivery events.",
  },
  {
    provider: "RevenueCat, Apple App Store, and Google Play",
    purpose: "Purchases, subscriptions, entitlement status, restoration, and customer subscription management.",
    data: "MyTurn user ID, app-store account/transaction identifiers, product, purchase, subscription, and entitlement information. MyTurn does not receive your full payment-card number.",
  },
  {
    provider: "Apple and Google sign-in",
    purpose: "Optional social sign-in when enabled and selected by you.",
    data: "Provider account identifier, email, name or profile image if released by you, and authentication tokens.",
  },
] as const;

export const PRIVACY_POLICY_SECTIONS: readonly PrivacyPolicySection[] = [
  {
    id: "scope",
    title: "1. Scope and who is responsible",
    paragraphs: [
      "This Privacy Policy explains how MyTurn collects, uses, discloses, retains, and protects personal information when you use the MyTurn iOS or Android app and the supporting Next.js APIs, media delivery, widgets, notifications, support channels, beta program, and paid features (together, the “Services”).",
      "MyTurn is operated by Mehmet Emir Özdiş, an individual independent developer based in İzmir, Türkiye. Mehmet Emir Özdiş is the data controller or business responsible for personal information covered by this Policy. MyTurn is initially directed to users in Türkiye and may be made available internationally. Privacy questions and requests can be sent to support@myturn.emirozdis.tr or submitted through https://myturn.emirozdis.tr/account.",
      "This Policy does not govern services that you visit independently through a third-party link. Those services apply their own privacy policies.",
    ],
  },
  {
    id: "collection",
    title: "2. Personal information we collect",
    paragraphs: [
      "The information we collect depends on the features you use. We collect the following categories:",
    ],
    items: [
      "Account and authentication information: name, email address, email-verification status, password hash, account creation date, session and security tokens, and—if you use Apple or Google sign-in—the provider account identifier, authentication tokens, and profile details the provider releases.",
      "Profile and location information: username/handle, profile image, biography, location text you enter, and a city/country label derived on your device from location access when you open the camera. You can edit or remove the derived label before posting. Precise coordinates are not included with the post.",
      "Content and media: videos, audio within videos, photos, photo or video responses, thumbnails, captions, prompts, comments, and technical media metadata such as recording time, duration, format, processing status, and any location label you add. We create transcoded and lower-resolution copies to deliver media reliably.",
      "Group and social information: group names and images, invite codes, memberships, roles, friendships and requests, daily assignments, volunteers, reactions, comments, views, pokes, streaks, achievements, XP, boosts, and the times those actions occur.",
      "Purchase information: products, app-store transaction identifiers, subscription and entitlement status, restoration status, and boost credits. Payment details are handled by Apple or Google; MyTurn does not receive your full card number.",
      "Communications: beta signup email, support messages, privacy requests, and verification or password-reset communications.",
      "Device, network, and security information: IP address, user agent, device type, operating system, app version, language, timestamps, session identifiers, Firebase App Check attestation signals, push notification tokens, request and delivery logs, and abuse-prevention signals.",
      "Analytics and diagnostics: screens viewed, feature interactions such as joining a group or posting a response, pseudonymous installation/session or account user ID, app performance, crash reports, stack traces, component and route names, request outcomes, and a limited window of technical events before and after an error. User-generated media, passwords, authentication tokens, and message contents are not intentionally included in diagnostic events.",
      "On-device information: login state, language and haptic preferences, active group, viewed-state markers, pending uploads, widget state, API responses, and downloaded media segments stored in app or widget storage to make the Services work faster and offline. This information remains on your device unless it is uploaded as part of a requested feature or diagnostic report.",
    ],
  },
  {
    id: "permissions",
    title: "3. Device permissions",
    paragraphs: [
      "MyTurn asks for device permissions in connection with the features you choose. Camera and microphone access are requested when you open the camera and are used to capture videos, photos, and responses. Location access is requested when you open the camera so the app can derive a city/country label for the post; the label remains editable and precise coordinates are not uploaded with the post. Photo-library access is used when you select a profile or group image. Notification permission is requested after registration, and a push token is used to deliver reminders and activity alerts. You can deny or later revoke these permissions in your device settings, although the related feature may stop working.",
      "MyTurn does not request access to your contacts. Location processing is limited to deriving the editable post label described above.",
    ],
  },
  {
    id: "sources",
    title: "4. Where information comes from",
    items: [
      "Directly from you when you register, build a profile, create or interact with content, buy a feature, join a beta, or contact us.",
      "Automatically from your device and use of the Services through app storage, SDKs, backend logs, analytics, and security tools.",
      "From other users when they invite you, add you to a group, interact with your content, or include you in content they upload.",
      "From Apple, Google, RevenueCat, and other providers when you use sign-in, purchase, notification, or security services.",
    ],
  },
  {
    id: "use",
    title: "5. How and why we use information",
    items: [
      "Provide the Services: register and authenticate accounts; create groups and feeds; assign turns; upload, transcode, store, archive, and deliver media; enable comments and reactions; synchronize widgets; and deliver notifications.",
      "Personalize your experience: remember settings, show relevant group activity, calculate streaks and achievements, and restore subscription benefits.",
      "Operate and improve MyTurn: understand feature use, troubleshoot errors, monitor performance, develop features, and manage storage capacity.",
      "Protect people and the Services: verify genuine app requests, prevent spam and fraud, rate-limit abuse, investigate security incidents, enforce our Terms, and protect legal rights and safety.",
      "Communicate: verify email addresses, reset passwords, answer support and privacy requests, send service notices, and provide material policy or product updates.",
      "Comply with law: preserve or disclose information when legally required, respond to lawful requests, and establish or defend legal claims.",
    ],
    paragraphs: [
      "Where a law requires a legal basis, we rely on performance of our contract with you for core account, group, media, and purchase functions; our legitimate interests in operating, securing, and improving MyTurn where those interests are not overridden by your rights; consent for device permissions or other processing where consent is required; and compliance with legal obligations. You may withdraw consent at any time for future processing, but withdrawal does not affect earlier lawful processing.",
    ],
  },
  {
    id: "visibility",
    title: "6. Who can see your information",
    paragraphs: [
      "Your display name, handle, profile image, biography, location text, and limited activity or achievement details can be visible to other MyTurn users through search, friendship, profile, and group features. Content and interactions posted to a group are available to members of that group as the product indicates. Invite codes allow people who possess the code to request or obtain access to the associated group.",
      "Private groups reduce public exposure but cannot prevent a recipient from taking a screenshot, making a recording, downloading available content, or sharing it outside MyTurn. Only upload content you are comfortable sharing with every current and future member of the selected group, and obtain permission from people shown or heard in it.",
    ],
  },
  {
    id: "disclosure",
    title: "7. When we disclose information",
    items: [
      "With other users, as described above and as directed by your group, friendship, and sharing choices.",
      "With service providers that host, store, process, deliver, analyze, secure, support, or bill for the Services. The current provider inventory appears below.",
      "With Apple or Google when you ask to sign in, make or restore a purchase, manage a subscription, receive a notification, or use their platform services. They may act as independent controllers for their own account, store, and payment operations.",
      "With authorities, courts, advisers, or affected parties when we reasonably believe disclosure is required by law; needed to protect rights, safety, or the Services; or necessary to investigate fraud, abuse, or a security incident.",
      "As part of a merger, financing, acquisition, reorganization, bankruptcy, or transfer of all or part of the Services, subject to this Policy and legally required notice.",
      "With another party when you direct us to or give valid consent.",
    ],
    paragraphs: [
      "We do not sell personal information, share it for cross-context behavioral advertising, or disclose it to third-party advertising networks. We require service providers that receive user data to use it only for the service they provide and to maintain privacy and security protection consistent with this Policy and applicable law.",
    ],
  },
  {
    id: "tracking",
    title: "8. App storage, analytics, and tracking",
    paragraphs: [
      "The mobile apps use local storage for sign-in, security, preferences, media access, offline caching, widgets, and core functionality. Firebase Analytics is off by default. If you enable Share Usage Analytics in Settings, MyTurn uses it for screen and feature analytics and it can receive identifiers and technical or usage information as described above. You can turn it off again at any time; doing so disables future Analytics collection and resets the Analytics data stored by the SDK on that device. Crashlytics remains enabled for reliability and crash reporting and can receive identifiers and diagnostic information as described above.",
      "MyTurn does not use advertising SDKs, sell personal information, or share it for targeted advertising. If these practices change, we will update this section and provide any legally required choice before the new processing begins.",
    ],
  },
  {
    id: "retention",
    title: "9. Retention and deletion",
    items: [
      "Account, profile, group, social, and entitlement records are generally retained while your account is active and until you delete the account, unless a longer period is needed for a legal, safety, fraud, accounting, or dispute reason.",
      "The current media lifecycle moves eligible completed media from hot storage to archive storage after about two days, may remove the highest-resolution archived stream after about 30 days, and is designed to permanently delete clips and their associated responses after about 180 days. You may delete available content sooner.",
      "Upload sessions expire after two hours. A cleanup process runs every 30 minutes to abort expired multipart uploads, remove their session records, remove finalized upload-session records older than one hour, and reconcile or delete clips that remain in the uploading state for more than one hour.",
      "Push tokens are retained while registered to your account and are removed when you disable notifications, sign out successfully, delete the account, or when the provider reports that the token is invalid.",
      "Email-verification, password-reset, and web account-deletion codes expire after one hour and are removed when successfully used. Agreement acceptance records, feedback reports, and their account-linked attachments are retained with the account and are deleted through the account-deletion cascade.",
      "Local app caches and preferences remain until cleared in the app, removed during sign-out or account deletion where supported, or erased by uninstalling the app or clearing app data.",
      "MyTurn's database-backed warning incidents expire after 30 days by default, and error or fatal incidents expire after 90 days by default. The deployment can configure either period between 1 and 365 days. Incidents linked to your account are also deleted when your account is deleted. Firebase Analytics, Crashlytics, hosting, database backup, security, and email-delivery records remain subject to the production retention settings and deletion schedules of the applicable provider; those provider-controlled copies may remain until their configured expiry or backup overwrite.",
    ],
    paragraphs: [
      "Account deletion is available in Settings > Delete Account and at https://myturn.emirozdis.tr/account. After identity verification and confirmation, the deletion flow attempts immediate removal of the account and account-linked records from the active database, managed hot and archive media, feedback attachments, MyTurn diagnostic incidents, provider authorizations, and the RevenueCat customer record. If managed media deletion cannot be verified, the active account record is kept so deletion can be retried rather than silently orphaning inaccessible media. Deletion does not cancel a subscription billed by Apple or Google; cancel it in the applicable store. Limited residual copies can remain temporarily in provider backups, caches, logs, or independent store records until overwritten or expired, and narrowly limited information may be retained when law requires it or to prevent fraud and protect legal rights.",
    ],
  },
  {
    id: "security",
    title: "10. Security",
    paragraphs: [
      "We use measures designed to protect personal information, including encrypted network transport, password hashing, signed and time-limited media access, access controls, app attestation, rate limits, separated storage credentials, and restricted administrative access. Service providers are selected and configured to support appropriate safeguards. No online service is perfectly secure, so we cannot guarantee absolute security. Protect your password and group invite codes, keep your device secure, and contact us if you suspect unauthorized access.",
    ],
  },
  {
    id: "choices",
    title: "11. Your choices and controls",
    items: [
      "Profile: edit your name, handle, biography, image, and location text in Settings.",
      "Content: delete content where the applicable content menu offers deletion. Copies made by another user outside MyTurn are outside our control.",
      "Permissions: revoke camera, microphone, location, photo-library, or notification access in iOS or Android settings.",
      "Notifications: disable push registration in MyTurn Settings or in device settings. Some essential service or legal notices may still be sent by email.",
      "Analytics: enable or disable optional screen and feature usage analytics in MyTurn Settings. Analytics is off by default; crash and diagnostic reporting remains enabled.",
      "Local data: clear media and API caches in Advanced Settings, sign out, clear app data, or uninstall the app.",
      "Subscription: manage or cancel through the Apple App Store or Google Play account that bills you.",
      "Account: permanently delete your account in Settings > Delete Account or through the self-service identity-verification flow at https://myturn.emirozdis.tr/account. You can also email support@myturn.emirozdis.tr if a deletion control is unavailable.",
    ],
  },
  {
    id: "rights",
    title: "12. Privacy rights",
    paragraphs: [
      "Depending on where you live, you may have rights to know or access the personal information we hold about you; correct inaccurate information; delete information; receive a portable copy; restrict or object to processing; withdraw consent; and appeal a refusal. You may also have the right to complain to your local data-protection authority. Türkiye residents may exercise applicable rights under Article 11 of Law No. 6698 (KVKK). EEA and UK residents may exercise applicable GDPR rights and complain to the supervisory authority where they live or work.",
      "Send a request from the email connected to your account to support@myturn.emirozdis.tr and describe the right you want to exercise. We may ask for information reasonably necessary to verify your identity and authority. Authorized agents may submit a request where local law permits, but we will require proof of authorization and may verify the request with you. We will respond within the period required by applicable law. We will not discriminate against you for exercising a privacy right.",
    ],
  },
  {
    id: "california",
    title: "13. California notice",
    paragraphs: [
      "In the preceding 12 months, MyTurn has collected the following California categories: identifiers; customer-record information; commercial information; internet or other electronic network activity; approximate or voluntarily supplied location information; audio, electronic, visual, and similar information; account credentials; and inferences reflected in group participation, streaks, achievements, or preferences. The sources, business purposes, retention criteria, and recipient categories are described in Sections 2, 4, 5, 7, and 9.",
      "MyTurn has not sold personal information or shared it for cross-context behavioral advertising in the preceding 12 months and does not do so now. We do not knowingly sell or share the personal information of anyone under 16. Subject to the applicability and exceptions of California law, residents may request access to categories or specific pieces of personal information, correction, deletion, and information about collection and disclosure; may limit certain uses of sensitive personal information where that right applies; and may not be discriminated against for exercising a right. MyTurn uses account credentials only to provide and secure the Services, so no separate right-to-limit link is required for our current use.",
      "California’s “Shine the Light” law may permit residents to request information about disclosure of personal information to third parties for their direct-marketing purposes. MyTurn does not disclose personal information to third parties for their own direct marketing.",
    ],
  },
  {
    id: "transfers",
    title: "14. International processing",
    paragraphs: [
      "MyTurn is operated from Türkiye, is initially directed to users in Türkiye, and may be made available internationally. MyTurn's cloud, storage, analytics, crash-reporting, email, and purchase providers may process information in the United States, European Economic Area, Türkiye, and other countries where they operate. Those countries may have different privacy laws. Where required, we rely on the applicable provider data-processing terms and a recognized transfer mechanism, such as an adequacy decision, standard contractual clauses, a binding corporate mechanism, or another lawful safeguard. The final production regions and transfer terms must be verified in each provider account before release.",
    ],
  },
  {
    id: "children",
    title: "15. Children",
    paragraphs: [
      "MyTurn is a general-audience service and is not directed to children under 16. You must be at least 16, and if your country requires a higher age or valid parent or guardian authorization to use an online service or consent to personal-data processing, you must satisfy that requirement. We do not knowingly collect personal information from a child who cannot lawfully use the Services. If you believe that has happened, contact support@myturn.emirozdis.tr. We will investigate and delete the information when required.",
    ],
  },
  {
    id: "changes",
    title: "16. Changes to this Policy",
    paragraphs: [
      "We may update this Policy when the Services, providers, or law changes. We will publish the updated version through the app and backend and change the effective date. If a change materially affects how we use previously collected information, we will provide additional notice or seek consent when required. Earlier versions and acceptance records may be retained where needed to document the terms that applied.",
    ],
  },
  {
    id: "contact",
    title: "17. Contact",
    paragraphs: [
      "Operator and data controller: Mehmet Emir Özdiş, an individual operating MyTurn",
      "Contact location: İzmir, Türkiye",
      "Website: https://myturn.emirozdis.tr",
      "Privacy and support email: support@myturn.emirozdis.tr",
      "Include “Privacy Request” in the subject line for access, correction, deletion, portability, objection, restriction, consent withdrawal, or appeal requests. Please do not send passwords, full payment-card numbers, or unnecessary identity documents by email.",
    ],
  },
] as const;

export const PRIVACY_POLICY_TEXT = [
  `MYTURN PRIVACY POLICY`,
  `Version ${PRIVACY_POLICY_VERSION} | Effective ${PRIVACY_POLICY_EFFECTIVE_DATE}`,
  ...PRIVACY_POLICY_SECTIONS.flatMap((section) => [
    `\n${section.title}`,
    ...(section.paragraphs ?? []),
    ...(section.items ?? []).map((item) => `• ${item}`),
  ]),
  `\nCURRENT SERVICE PROVIDERS`,
  ...SERVICE_PROVIDERS.map(
    ({ provider, purpose, data }) => `• ${provider}: ${purpose} Data involved: ${data}`,
  ),
].join("\n\n");
