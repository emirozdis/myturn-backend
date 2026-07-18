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
  | "newPhotoReady";

export type NotificationRequest = {
  category: NotificationCategory;
  key: NotificationKey;
  vars?: Record<string, string | number | null | undefined>;
  url?: string;
};

type Copy = { title: string; body: string };
type CopyTable = Record<NotificationKey, Copy>;

const copy: Record<NotificationLocale, CopyTable> = {
  en: {
    cameraAvailable: { title: "Camera is up for grabs! 📷", body: "The vlogger missed their window. First to claim gets it!" },
    cameraClaimed: { title: "Camera claimed! 🏃", body: "{actor} claimed the camera and became today's vlogger!" },
    photoResponse: { title: "New response! 📸", body: "{actor} responded to your vlog in “{group}”." },
    poke: { title: "You've been poked! 👀", body: "{actor} is waiting for your MyTurn update in “{group}”." },
    reaction: { title: "New reaction! ❤️", body: "{actor} reacted {emoji} to your vlog in “{group}”." },
    mention: { title: "You were mentioned! 💬", body: "{actor} mentioned you: “{text}”" },
    commentReply: { title: "New reply! 💬", body: "{actor} replied to your comment: “{text}”" },
    comment: { title: "New comment! 💬", body: "{actor} commented: “{text}”" },
    slotReminder: { title: "Time for your {slot} vlog! 🎥", body: "Share a raw moment in “{group}” to keep the group streak alive!" },
    recapFriend: { title: "Daily recap ready! 🍿", body: "Yesterday's vlog in “{group}” is ready to watch!" },
    recapOwn: { title: "Your day is ready! 🎉", body: "Your vlog from yesterday in “{group}” is ready to share." },
    mandatoryTurn: { title: "Mandatory turn today! 📸", body: "You passed yesterday, so you're locked in to vlog for “{group}” today!" },
    yourTurn: { title: "It's your turn! 🎥", body: "You've been selected to vlog for “{group}” today. Tap to start recording." },
    todayVloggerSelected: { title: "Today's vlogger selected! 🍿", body: "Today's vlogger has been selected. Open MyTurn to see who it is." },
    friendRequest: { title: "New friend request! 👤", body: "{actor} sent you a friend request." },
    friendAccepted: { title: "Friend request accepted! 🎉", body: "{actor} accepted your friend request." },
    ownMomentReady: { title: "Your moment is ready ✨", body: "Processing finished. Your moment is now visible to the group." },
    newMomentReady: { title: "New moment ready 🎥", body: "{actor} shared a new moment in “{group}”." },
    ownPhotoReady: { title: "Your photo is ready ✨", body: "Your photo is now visible to the group." },
    newPhotoReady: { title: "New vlog post! 🎥", body: "{actor} posted a new moment in “{group}”." },
  },
  tr: {
    cameraAvailable: { title: "Kamera boşta! 📷", body: "Günün vlogger'ı süresini kaçırdı. İlk alan kamerayı kapar!" },
    cameraClaimed: { title: "Kamera alındı! 🏃", body: "{actor} kamerayı aldı ve günün vlogger'ı oldu!" },
    photoResponse: { title: "Yeni yanıt! 📸", body: "{actor}, “{group}” grubundaki vloguna yanıt verdi." },
    poke: { title: "Dürtüldün! 👀", body: "{actor}, “{group}” grubundaki MyTurn güncellemeni bekliyor." },
    reaction: { title: "Yeni tepki! ❤️", body: "{actor}, “{group}” grubundaki vloguna {emoji} ile tepki verdi." },
    mention: { title: "Bir yorumda bahsedildin! 💬", body: "{actor} senden bahsetti: “{text}”" },
    commentReply: { title: "Yeni yanıt! 💬", body: "{actor} yorumuna yanıt verdi: “{text}”" },
    comment: { title: "Yeni yorum! 💬", body: "{actor} yorum yaptı: “{text}”" },
    slotReminder: { title: "{slot} vlogunun zamanı! 🎥", body: "Grup serisini sürdürmek için “{group}” grubunda doğal bir anını paylaş!" },
    recapFriend: { title: "Günlük özet hazır! 🍿", body: "“{group}” grubundaki dünkü vlog izlemeye hazır!" },
    recapOwn: { title: "Günün hazır! 🎉", body: "“{group}” grubundaki dünkü vlogun paylaşmaya hazır." },
    mandatoryTurn: { title: "Bugün zorunlu sıra sende! 📸", body: "Dün pas geçtiğin için bugün “{group}” grubunda vlog sırası sende!" },
    yourTurn: { title: "Sıra sende! 🎥", body: "Bugün “{group}” grubu için vlog çekmek üzere seçildin. Kayda başlamak için dokun." },
    todayVloggerSelected: { title: "Bugünün vlogger'ı seçildi! 🍿", body: "Bugünün vlogger'ı seçildi. Kim olduğunu görmek için MyTurn'ü aç." },
    friendRequest: { title: "Yeni arkadaşlık isteği! 👤", body: "{actor} sana arkadaşlık isteği gönderdi." },
    friendAccepted: { title: "Arkadaşlık isteği kabul edildi! 🎉", body: "{actor} arkadaşlık isteğini kabul etti." },
    ownMomentReady: { title: "Anın hazır ✨", body: "İşleme tamamlandı. Anın artık grupta görülebilir." },
    newMomentReady: { title: "Yeni an hazır 🎥", body: "{actor}, “{group}” grubunda yeni bir an paylaştı." },
    ownPhotoReady: { title: "Fotoğrafın hazır ✨", body: "Fotoğrafın artık grupta görülebilir." },
    newPhotoReady: { title: "Yeni vlog paylaşımı! 🎥", body: "{actor}, “{group}” grubunda yeni bir an paylaştı." },
  },
};

const slotCopy: Record<NotificationLocale, Record<string, string>> = {
  en: { Morning: "morning", Midday: "midday", Afternoon: "afternoon", Evening: "evening", "Late Night": "late-night" },
  tr: { Morning: "sabah", Midday: "öğle", Afternoon: "öğleden sonra", Evening: "akşam", "Late Night": "gece" },
};

const fallbacks: Record<NotificationLocale, Record<string, string>> = {
  en: { actor: "A friend", group: "your group", emoji: "❤️", text: "…", slot: "daily" },
  tr: { actor: "Bir arkadaşın", group: "grubun", emoji: "❤️", text: "…", slot: "günlük" },
};

export function getNotificationCopy(localeValue: string, key: NotificationKey, vars: NotificationRequest["vars"] = {}): Copy {
  const locale: NotificationLocale = localeValue === "tr" ? "tr" : "en";
  const values = { ...fallbacks[locale], ...vars };
  if (typeof values.slot === "string") values.slot = slotCopy[locale][values.slot] || values.slot;
  const interpolate = (value: string) => value.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? fallbacks[locale][name] ?? ""));
  return { title: interpolate(copy[locale][key].title), body: interpolate(copy[locale][key].body) };
}
