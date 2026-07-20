export type NotificationLocale = "en" | "tr";

export type NotificationCategory =
  | "turns"
  | "reminders"
  | "posts"
  | "interactions"
  | "social"
  | "recaps";

export type NotificationKey =
  | "cameraAvailable"
  | "cameraClaimed"
  | "photoResponse"
  | "poke"
  | "reaction"
  | "mention"
  | "commentReply"
  | "comment"
  | "slotReminder"
  | "recapFriend"
  | "recapOwn"
  | "mandatoryTurn"
  | "yourTurn"
  | "todayVloggerSelected"
  | "friendRequest"
  | "friendAccepted"
  | "ownMomentReady"
  | "newMomentReady"
  | "ownPhotoReady"
  | "newPhotoReady"
  | "uploadPausedNetwork"
  | "uploadPausedServer"
  | "uploadProgress";

export type NotificationRequest = {
  category: NotificationCategory;
  key: Exclude<NotificationKey, "uploadPausedNetwork" | "uploadPausedServer" | "uploadProgress">;
  vars?: NotificationVariables;
  deepLink: NotificationDeepLink;
};

export type NotificationScreen = "today" | "record" | "streaks" | "social";

export type NotificationDeepLink = {
  screen: NotificationScreen;
  groupId?: string;
  clipId?: string;
  assignmentId?: string;
  date?: string;
  focus?: "comments" | "responses" | "reactions" | "friendRequests" | "profile" | "upload";
  itemId?: string;
  userId?: string;
};

export type NotificationVariables = Record<string, string | number | null | undefined>;

type NotificationText = { title: string; body: string };
type NotificationTextTable = Record<NotificationKey, NotificationText>;

// This is the single source of truth for every user-facing push and local
// notification. Keep both locales together so copy changes stay in sync.
export const notificationTexts: Record<NotificationLocale, NotificationTextTable> = {
  en: {
    cameraAvailable: {
      title: "The camera is available 📷",
      body: "The selected vlogger missed their turn. Open MyTurn to claim the camera.",
    },
    cameraClaimed: {
      title: "The camera was claimed 🏃",
      body: "{actor} claimed the camera and is today's vlogger.",
    },
    photoResponse: {
      title: "New photo response 📸",
      body: "{actor} responded to your vlog in “{group}.”",
    },
    poke: {
      title: "{actor} sent you a reminder 👀",
      body: "Your group is waiting for your update in “{group}.”",
    },
    reaction: {
      title: "New reaction {emoji}",
      body: "{actor} reacted to your vlog in “{group}.”",
    },
    mention: {
      title: "You were mentioned 💬",
      body: "{actor} mentioned you: “{text}”",
    },
    commentReply: {
      title: "New reply 💬",
      body: "{actor} replied to your comment: “{text}”",
    },
    comment: {
      title: "New comment 💬",
      body: "{actor} commented on your vlog: “{text}”",
    },
    slotReminder: {
      title: "Time for your {slot} vlog 🎥",
      body: "Share a moment in “{group}” to keep your group streak going.",
    },
    recapFriend: {
      title: "Yesterday's story is ready 🍿",
      body: "The daily recap for “{group}” is ready to watch.",
    },
    recapOwn: {
      title: "Your story is ready 🎉",
      body: "Your vlog from yesterday in “{group}” is ready to watch and share.",
    },
    mandatoryTurn: {
      title: "It's your turn today 📸",
      body: "You passed yesterday, so today you are the vlogger for “{group}.”",
    },
    yourTurn: {
      title: "It's your turn 🎥",
      body: "You are today's vlogger for “{group}.” Tap to start recording.",
    },
    todayVloggerSelected: {
      title: "Today's vlogger was selected 🍿",
      body: "Open MyTurn to see who is recording for your group today.",
    },
    friendRequest: {
      title: "New friend request 👤",
      body: "{actor} sent you a friend request.",
    },
    friendAccepted: {
      title: "Friend request accepted 🎉",
      body: "{actor} accepted your friend request.",
    },
    ownMomentReady: {
      title: "Your moment is ready ✨",
      body: "Processing is complete. Your moment is now visible to the group.",
    },
    newMomentReady: {
      title: "New moment in {group} 🎥",
      body: "{actor} shared a new moment. Tap to watch it.",
    },
    ownPhotoReady: {
      title: "Your photo is ready ✨",
      body: "Your photo is now visible to the group.",
    },
    newPhotoReady: {
      title: "New post in {group} 📸",
      body: "{actor} shared a new photo. Tap to view it.",
    },
    uploadPausedNetwork: {
      title: "Upload paused ⚠️",
      body: "Check your internet connection, then tap to continue the upload.",
    },
    uploadPausedServer: {
      title: "Upload could not finish ⚠️",
      body: "We could not reach the server. Tap to try the upload again.",
    },
    uploadProgress: {
      title: "Uploading your vlog 📤",
      body: "{progressBar} {progress}% complete. Your vlog is uploading in the background.",
    },
  },
  tr: {
    cameraAvailable: {
      title: "Kamera boşta 📷",
      body: "Seçilen vlogger sırasını kaçırdı. Kamerayı almak için MyTurn'ü aç.",
    },
    cameraClaimed: {
      title: "Kamera alındı 🏃",
      body: "{actor} kamerayı aldı ve bugünün vlogger'ı oldu.",
    },
    photoResponse: {
      title: "Yeni fotoğraf yanıtı 📸",
      body: "{actor}, “{group}” grubundaki vloguna yanıt verdi.",
    },
    poke: {
      title: "{actor} sana hatırlatma gönderdi 👀",
      body: "“{group}” grubu güncellemeni bekliyor.",
    },
    reaction: {
      title: "Yeni tepki {emoji}",
      body: "{actor}, “{group}” grubundaki vloguna tepki verdi.",
    },
    mention: {
      title: "Senden bahsedildi 💬",
      body: "{actor} senden bahsetti: “{text}”",
    },
    commentReply: {
      title: "Yeni yanıt 💬",
      body: "{actor} yorumuna yanıt verdi: “{text}”",
    },
    comment: {
      title: "Yeni yorum 💬",
      body: "{actor} vloguna yorum yaptı: “{text}”",
    },
    slotReminder: {
      title: "{slot} vlogunun zamanı 🎥",
      body: "Grup serisini sürdürmek için “{group}” grubunda bir anını paylaş.",
    },
    recapFriend: {
      title: "Dünkü hikaye hazır 🍿",
      body: "“{group}” grubunun günlük özeti izlemeye hazır.",
    },
    recapOwn: {
      title: "Hikayen hazır 🎉",
      body: "“{group}” grubundaki dünkü vlogun izlemeye ve paylaşmaya hazır.",
    },
    mandatoryTurn: {
      title: "Bugün sıra sende 📸",
      body: "Dün pas geçtiğin için bugün “{group}” grubunun vlogger'ı sensin.",
    },
    yourTurn: {
      title: "Sıra sende 🎥",
      body: "Bugün “{group}” grubunun vlogger'ı sensin. Kayda başlamak için dokun.",
    },
    todayVloggerSelected: {
      title: "Bugünün vlogger'ı seçildi 🍿",
      body: "Bugün grubun için kimin kayıt yapacağını görmek için MyTurn'ü aç.",
    },
    friendRequest: {
      title: "Yeni arkadaşlık isteği 👤",
      body: "{actor} sana arkadaşlık isteği gönderdi.",
    },
    friendAccepted: {
      title: "Arkadaşlık isteğin kabul edildi 🎉",
      body: "{actor} arkadaşlık isteğini kabul etti.",
    },
    ownMomentReady: {
      title: "Anın hazır ✨",
      body: "İşleme tamamlandı. Anın artık grupta görülebilir.",
    },
    newMomentReady: {
      title: "“{group}” grubunda yeni an 🎥",
      body: "{actor} yeni bir an paylaştı. İzlemek için dokun.",
    },
    ownPhotoReady: {
      title: "Fotoğrafın hazır ✨",
      body: "Fotoğrafın artık grupta görülebilir.",
    },
    newPhotoReady: {
      title: "“{group}” grubunda yeni paylaşım 📸",
      body: "{actor} yeni bir fotoğraf paylaştı. Görmek için dokun.",
    },
    uploadPausedNetwork: {
      title: "Yükleme duraklatıldı ⚠️",
      body: "İnternet bağlantını kontrol et, ardından yüklemeye devam etmek için dokun.",
    },
    uploadPausedServer: {
      title: "Yükleme tamamlanamadı ⚠️",
      body: "Sunucuya ulaşılamadı. Yüklemeyi yeniden denemek için dokun.",
    },
    uploadProgress: {
      title: "Vlogun yükleniyor 📤",
      body: "{progressBar} %{progress} tamamlandı. Vlogun arka planda yükleniyor.",
    },
  },
};

const slotTexts: Record<NotificationLocale, Record<string, string>> = {
  en: { Morning: "morning", Midday: "midday", Afternoon: "afternoon", Evening: "evening", "Late Night": "late-night" },
  tr: { Morning: "sabah", Midday: "öğle", Afternoon: "öğleden sonra", Evening: "akşam", "Late Night": "gece" },
};

const fallbackVariables: Record<NotificationLocale, Record<string, string>> = {
  en: { actor: "A friend", group: "your group", emoji: "❤️", text: "…", slot: "daily", progress: "0", progressBar: "" },
  tr: { actor: "Bir arkadaşın", group: "grubun", emoji: "❤️", text: "…", slot: "günlük", progress: "0", progressBar: "" },
};

export function getNotificationLocale(locale: unknown, fallback: NotificationLocale = "en"): NotificationLocale {
  return locale === "en" || locale === "tr" ? locale : fallback;
}

export function getNotificationText(
  localeValue: unknown,
  key: NotificationKey,
  variables: NotificationVariables = {},
  fallbackLocale: NotificationLocale = "en",
): NotificationText {
  const locale = getNotificationLocale(localeValue, fallbackLocale);
  const values = { ...fallbackVariables[locale], ...variables };

  if (typeof values.slot === "string") {
    values.slot = slotTexts[locale][values.slot] || values.slot;
  }

  const interpolate = (text: string) => text.replace(
    /\{(\w+)\}/g,
    (_, name: string) => String(values[name] ?? fallbackVariables[locale][name] ?? ""),
  );

  const template = notificationTexts[locale][key];
  return { title: interpolate(template.title), body: interpolate(template.body) };
}

export function createNotificationDeepLink(deepLink: NotificationDeepLink): string {
  const query = Object.entries(deepLink)
    .filter(([key, value]) => key !== "screen" && typeof value === "string" && value.length > 0)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");

  return `/${deepLink.screen}${query ? `?${query}` : ""}`;
}
