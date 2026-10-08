import {
  getEligiblePublicGroups,
  getPublicGroupByCode,
  normalizeGroupCode,
  type GroupCadence,
  type GroupLanguage,
  type GroupLocationMode,
  type PublicGroup,
} from "./catalog";

export type MatchConversationEntry = {
  role: "user" | "assistant";
  content: string;
};

export type MatchPreferences = {
  locale: GroupLanguage;
  requestedCode: string | null;
  contributionUsdc: number | null;
  contributionIsMaximum: boolean;
  cadence: GroupCadence | null;
  language: GroupLanguage;
  locationMode: GroupLocationMode | null;
  city: string | null;
  desiredMemberCount: number | null;
  wantsSoonStart: boolean;
  wantsStrongCollateral: boolean;
  interests: readonly string[];
};

export type GroupMatch = {
  code: string;
  groupCode: string;
  name: string;
  score: number;
  reasons: string[];
  tradeoffs: string[];
  contributionUsdc: number;
  cadence: GroupCadence;
  languages: readonly GroupLanguage[];
  location: PublicGroup["location"];
  start: PublicGroup["start"];
  seatsAvailable: number;
  memberSlots: PublicGroup["memberSlots"];
  postPayoutCollateral: PublicGroup["postPayoutCollateral"];
  interests: readonly string[];
  listingSource: PublicGroup["listingSource"];
  accountAddress: string;
};

export type DeterministicMatchResult = {
  locale: GroupLanguage;
  preferences: MatchPreferences;
  requestedCodeStatus: "eligible" | "unavailable" | "constraint-mismatch" | "not-found" | null;
  notice: string | null;
  matches: GroupMatch[];
  answer: string;
};

type MatchInput = {
  message: string;
  groups: readonly PublicGroup[];
  history?: readonly MatchConversationEntry[];
  locale?: GroupLanguage;
  limit?: number;
};

const CADENCE_WORDS: Readonly<Record<GroupCadence, readonly string[]>> = {
  weekly: ["haftalik", "her hafta", "weekly", "every week"],
  biweekly: [
    "iki haftada bir",
    "iki haftalik",
    "2 haftada bir",
    "biweekly",
    "fortnightly",
    "every two weeks",
    "every 2 weeks",
  ],
  monthly: ["aylik", "her ay", "monthly", "every month"],
};

const INTEREST_WORDS: ReadonlyArray<{
  interest: string;
  words: readonly string[];
}> = [
  { interest: "web3", words: ["web3", "crypto", "kripto", "blockchain", "solana"] },
  { interest: "software", words: ["software", "developer", "coder", "yazilim", "gelistirici"] },
  { interest: "startups", words: ["startup", "start-up", "girisim", "kurucu", "founder"] },
  { interest: "product", words: ["product", "urun"] },
  { interest: "design", words: ["design", "designer", "tasarim", "tasarimci"] },
  { interest: "creators", words: ["creator", "creative", "icerik", "uretic"] },
  { interest: "freelance", words: ["freelance", "freelancer", "serbest calis"] },
  { interest: "students", words: ["student", "ogrenci", "universite"] },
  { interest: "learning", words: ["learn", "learning", "ogren", "baslangic", "beginner"] },
  { interest: "community", words: ["community", "topluluk", "dayanisma"] },
  { interest: "business", words: ["business", "isletme", "profesyonel"] },
  { interest: "operations", words: ["operations", "operator", "operasyon"] },
  { interest: "climate", words: ["climate", "iklim", "cevre"] },
  { interest: "sustainability", words: ["sustainability", "surdurulebilir"] },
  { interest: "local-impact", words: ["local impact", "yerel etki", "sosyal etki"] },
  { interest: "remote-work", words: ["remote work", "uzaktan calis", "digital nomad"] },
  { interest: "travel", words: ["travel", "seyahat", "gezgin", "nomad"] },
];

export function normalizeSearchText(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(text: string, words: readonly string[]): boolean {
  return words.some((word) => text.includes(word));
}

function inferLocale(message: string, explicit?: GroupLanguage): GroupLanguage {
  if (explicit) return explicit;
  const normalized = normalizeSearchText(message);
  const turkishSignals = [
    " bir ",
    " icin",
    " istiyorum",
    " ariyorum",
    " butce",
    " haftalik",
    " aylik",
    " uzaktan",
    " grup",
    " uygun",
  ];
  const padded = ` ${normalized} `;
  return includesAny(padded, turkishSignals) || /[çğıöşü]/i.test(message)
    ? "tr"
    : "en";
}

function parseNumber(value: string): number | null {
  const compact = value.replace(/\s/g, "");
  let normalized = compact;
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(compact)) {
    normalized = compact.replace(/[.,]/g, "");
  } else if (compact.includes(",") && !compact.includes(".")) {
    normalized = compact.replace(",", ".");
  } else if (compact.includes(",") && compact.includes(".")) {
    normalized = compact.replace(/,/g, "");
  }

  const number = Number(normalized);
  return Number.isFinite(number) && number > 0 && number <= 100_000 ? number : null;
}

function extractContribution(text: string): number | null {
  const currencyAfter = text.match(/(\d{1,6}(?:[.,]\d{1,3})?)\s*(?:usdc|usd|dolar)/);
  if (currencyAfter) return parseNumber(currencyAfter[1]);

  const currencyBefore = text.match(/(?:usdc|usd|dolar)\s*(\d{1,6}(?:[.,]\d{1,3})?)/);
  if (currencyBefore) return parseNumber(currencyBefore[1]);

  const contextualAfter = text.match(
    /(?:butce|budget|katki|contribution|odeme|odemek|pay)\D{0,18}(\d{1,6}(?:[.,]\d{1,3})?)/,
  );
  if (contextualAfter) return parseNumber(contextualAfter[1]);

  const contextualBefore = text.match(
    /(\d{1,6}(?:[.,]\d{1,3})?)\D{0,18}(?:butce|budget|katki|contribution|odeme|odemek)/,
  );
  return contextualBefore ? parseNumber(contextualBefore[1]) : null;
}

function extractCadence(text: string): GroupCadence | null {
  if (includesAny(text, CADENCE_WORDS.biweekly)) return "biweekly";
  if (includesAny(text, CADENCE_WORDS.weekly)) return "weekly";
  if (includesAny(text, CADENCE_WORDS.monthly)) return "monthly";
  return null;
}

function extractLocationMode(text: string): GroupLocationMode | null {
  if (includesAny(text, ["hybrid", "hibrit"])) return "hybrid";
  if (includesAny(text, ["remote", "online", "uzaktan", "cevrimici"])) return "remote";
  if (includesAny(text, ["in person", "face to face", "yuz yuze", "yerel bulusma"])) {
    return "in-person";
  }
  return null;
}

function extractCity(text: string): string | null {
  if (text.includes("istanbul")) return "Istanbul";
  if (text.includes("ankara")) return "Ankara";
  if (text.includes("izmir")) return "Izmir";
  return null;
}

function extractRequestedCode(text: string): string | null {
  const possibleCode = text.match(/\brng[\s_-]?[a-f0-9]{12}\b/i)?.[0];
  return possibleCode ? normalizeGroupCode(possibleCode) : null;
}

function extractDesiredMemberCount(text: string): number | null {
  const match = text.match(/\b(\d{1,2})\s*(?:kisilik|kisi|members?|people|persons?)\b/);
  if (!match) return null;
  const count = Number(match[1]);
  return count >= 2 && count <= 30 ? count : null;
}

function extractInterests(texts: readonly string[]): string[] {
  const interests = new Set<string>();
  for (const text of texts) {
    for (const mapping of INTEREST_WORDS) {
      if (includesAny(text, mapping.words)) interests.add(mapping.interest);
    }
  }
  return [...interests];
}

function firstFromLatest<T>(texts: readonly string[], extract: (text: string) => T | null): T | null {
  for (const text of texts) {
    const value = extract(text);
    if (value !== null) return value;
  }
  return null;
}

export function parseMatchPreferences(input: MatchInput): MatchPreferences {
  const current = normalizeSearchText(input.message);
  const previousUserMessages = [...(input.history ?? [])]
    .reverse()
    .filter((entry) => entry.role === "user")
    .map((entry) => normalizeSearchText(entry.content));
  // Current preferences override older turns while missing fields can still be
  // filled from recent user history.
  const latestFirst = [current, ...previousUserMessages];
  const locale = inferLocale(input.message, input.locale);
  const allText = latestFirst.join(" ");

  return {
    locale,
    requestedCode: firstFromLatest(latestFirst, extractRequestedCode),
    contributionUsdc: firstFromLatest(latestFirst, extractContribution),
    contributionIsMaximum: includesAny(allText, [
      "en fazla",
      "butcem",
      "butce",
      "maximum",
      "max ",
      "up to",
      "at most",
      "under ",
      "altinda",
    ]),
    cadence: firstFromLatest(latestFirst, extractCadence),
    language: includesAny(current, ["english", "ingilizce"])
      ? "en"
      : includesAny(current, ["turkish", "turkce"])
        ? "tr"
        : locale,
    locationMode: firstFromLatest(latestFirst, extractLocationMode),
    city: firstFromLatest(latestFirst, extractCity),
    desiredMemberCount: firstFromLatest(latestFirst, extractDesiredMemberCount),
    wantsSoonStart: includesAny(allText, [
      "hemen",
      "en kisa",
      "yakinda",
      "bu ay",
      "asap",
      "soon",
      "this month",
      "earliest",
    ]),
    wantsStrongCollateral: includesAny(allText, [
      "teminat",
      "guvence",
      "guvenli",
      "collateral",
      "security",
      "protected",
    ]),
    interests: extractInterests(latestFirst),
  };
}

function cadenceLabel(cadence: GroupCadence, locale: GroupLanguage): string {
  const labels: Record<GroupLanguage, Record<GroupCadence, string>> = {
    tr: { weekly: "haftalık", biweekly: "iki haftada bir", monthly: "aylık" },
    en: { weekly: "weekly", biweekly: "biweekly", monthly: "monthly" },
  };
  return labels[locale][cadence];
}

function locationLabel(group: Pick<PublicGroup, "location">, locale: GroupLanguage): string {
  if (group.location.mode === "unspecified") {
    return locale === "tr" ? "konumu zincirde belirtilmemiş" : "location not recorded on-chain";
  }
  if (group.location.mode === "remote") return locale === "tr" ? "uzaktan" : "remote";
  const mode =
    group.location.mode === "hybrid"
      ? locale === "tr"
        ? "hibrit"
        : "hybrid"
      : locale === "tr"
        ? "yüz yüze"
        : "in person";
  return group.location.city ? `${group.location.city} · ${mode}` : mode;
}

function overlapInterests(group: PublicGroup, interests: readonly string[]): string[] {
  const groupInterests = new Set(group.interests);
  return interests.filter((interest) => groupInterests.has(interest));
}

function scoreGroup(group: PublicGroup, preferences: MatchPreferences): GroupMatch {
  const tr = preferences.locale === "tr";
  const reasons: string[] = [];
  const tradeoffs: string[] = [];
  let score = 24 + Math.min(group.memberSlots.available, 5);

  if (preferences.requestedCode === group.code) {
    score += 100;
    reasons.push(tr ? "İstediğin grup koduyla tam eşleşiyor." : "Exact match for the group code you requested.");
  }

  if (preferences.contributionUsdc !== null) {
    const target = preferences.contributionUsdc;
    const differenceRatio = Math.abs(group.contributionUsdc - target) / Math.max(target, 1);
    if (preferences.contributionIsMaximum) {
      if (group.contributionUsdc <= target) {
        score += 29 - Math.min(12, differenceRatio * 12);
        reasons.push(
          tr
            ? `${group.contributionUsdc} USDC katkı, ${target} USDC bütçe sınırının içinde.`
            : `${group.contributionUsdc} USDC is within your ${target} USDC budget ceiling.`,
        );
      } else {
        score -= 30 + Math.min(20, differenceRatio * 15);
        tradeoffs.push(
          tr
            ? `Katkı, belirttiğin üst sınırdan ${group.contributionUsdc - target} USDC fazla.`
            : `Contribution is ${group.contributionUsdc - target} USDC above your stated ceiling.`,
        );
      }
    } else if (differenceRatio <= 0.1) {
      score += 30;
      reasons.push(tr ? "Katkı tutarı hedefinle çok yakın." : "Contribution is very close to your target.");
    } else {
      score += Math.max(-18, 23 - differenceRatio * 40);
      tradeoffs.push(
        tr
          ? `Hedefin ${target} USDC; bu grubun katkısı ${group.contributionUsdc} USDC.`
          : `Your target is ${target} USDC; this group contributes ${group.contributionUsdc} USDC.`,
      );
    }
  }

  if (preferences.cadence) {
    if (preferences.cadence === group.cadence) {
      score += 25;
      reasons.push(
        tr
          ? `${cadenceLabel(group.cadence, "tr")} ritim tercihinle eşleşiyor.`
          : `${cadenceLabel(group.cadence, "en")} cadence matches your preference.`,
      );
    } else {
      score -= 13;
      tradeoffs.push(
        tr
          ? `Sen ${cadenceLabel(preferences.cadence, "tr")} istedin; grup ${cadenceLabel(group.cadence, "tr")} ilerliyor.`
          : `You asked for ${cadenceLabel(preferences.cadence, "en")}; this group runs ${cadenceLabel(group.cadence, "en")}.`,
      );
    }
  }

  if (group.languages.length === 0) {
    tradeoffs.push(
      tr
        ? "İletişim dili zincir üstü grup verisinde kayıtlı değil."
        : "Communication language is not recorded on-chain.",
    );
  } else if (group.languages.includes(preferences.language)) {
    score += 11;
    reasons.push(
      tr
          ? `${preferences.language === "tr" ? "Türkçe" : "İngilizce"} iletişimi destekliyor.`
        : `Supports ${preferences.language === "tr" ? "Turkish" : "English"}.`,
    );
  } else {
    score -= 18;
    tradeoffs.push(tr ? "Tercih ettiğin dili desteklemiyor." : "Does not support your preferred language.");
  }

  if (preferences.city) {
    if (group.location.city === preferences.city) {
      score += 22;
      reasons.push(tr ? `${preferences.city} konumuyla eşleşiyor.` : `Matches your ${preferences.city} location.`);
    } else if (group.location.mode === "remote") {
      score += 6;
      reasons.push(tr ? "Uzaktan olduğu için şehirden bağımsız katılabilirsin." : "Remote access works from your city.");
    } else {
      score -= 16;
      tradeoffs.push(
        tr
          ? `Grup ${group.location.city ?? "farklı bir konumda"}; sen ${preferences.city} belirttin.`
          : `The group is in ${group.location.city ?? "another location"}; you specified ${preferences.city}.`,
      );
    }
  }

  if (preferences.locationMode && group.location.mode === "unspecified") {
    tradeoffs.push(
      tr
        ? "Katılım biçimi zincir üstü grup verisinde kayıtlı değil."
        : "Participation mode is not recorded on-chain.",
    );
  } else if (preferences.locationMode) {
    const compatible =
      group.location.mode === preferences.locationMode ||
      (group.location.mode === "hybrid" && preferences.locationMode !== "hybrid");
    if (compatible) {
      score += 17;
      reasons.push(
        tr
          ? `${locationLabel(group, "tr")} katılım tercihine uygun.`
          : `${locationLabel(group, "en")} participation fits your preference.`,
      );
    } else {
      score -= 12;
      tradeoffs.push(
        tr
          ? `Katılım modeli ${locationLabel(group, "tr")}.`
          : `Participation mode is ${locationLabel(group, "en")}.`,
      );
    }
  }

  const interests = overlapInterests(group, preferences.interests);
  if (interests.length > 0) {
    score += Math.min(21, interests.length * 7);
    reasons.push(
      tr
        ? `Ortak ilgi alanları: ${interests.slice(0, 3).join(", ")}.`
        : `Shared interests: ${interests.slice(0, 3).join(", ")}.`,
    );
  }

  if (preferences.desiredMemberCount !== null) {
    const difference = Math.abs(group.memberSlots.total - preferences.desiredMemberCount);
    if (difference === 0) {
      score += 10;
      reasons.push(tr ? "Grup büyüklüğü tam istediğin gibi." : "Group size is an exact match.");
    } else {
      score -= Math.min(8, difference * 2);
      tradeoffs.push(
        tr
          ? `İstediğin ${preferences.desiredMemberCount} kişi yerine kapasite ${group.memberSlots.total}.`
          : `Capacity is ${group.memberSlots.total}, not your requested ${preferences.desiredMemberCount}.`,
      );
    }
  }

  if (preferences.wantsSoonStart) {
    tradeoffs.push(
      tr
        ? "Planlanan başlangıç tercihi mevcut Group hesabında kayıtlı değil."
        : "A planned start preference is not stored in the current Group account.",
    );
  }

  if (preferences.wantsStrongCollateral) {
    score += 10;
    reasons.push(
      tr
        ? "Ödeme sonrası kalan planlı katkılar yüzde 100 teminat kapsamında."
        : "100% collateral scope for remaining scheduled contributions after payout.",
    );
  }

  if (reasons.length === 0) {
    reasons.push(
      tr
        ? `${group.memberSlots.available} açık kontenjanı olan aktif bir katalog eşleşmesi.`
        : `An active catalog match with ${group.memberSlots.available} open seats.`,
    );
  }

  if (tradeoffs.length === 0) {
    tradeoffs.push(
      tr
        ? `İlk sıradaki alıcı için azami teminat ${group.postPayoutCollateral.maximumUsdc} USDC; kilit tur ilerledikçe azalır.`
        : `Maximum first-recipient collateral is ${group.postPayoutCollateral.maximumUsdc} USDC; the lock declines by round.`,
    );
  }

  return {
    code: group.code,
    groupCode: group.code,
    name: group.name,
    score: Math.round(Math.max(0, Math.min(100, score))),
    reasons: reasons.slice(0, 3),
    tradeoffs: tradeoffs.slice(0, 2),
    contributionUsdc: group.contributionUsdc,
    cadence: group.cadence,
    languages: group.languages,
    location: group.location,
    start: group.start,
    seatsAvailable: group.memberSlots.available,
    memberSlots: group.memberSlots,
    postPayoutCollateral: group.postPayoutCollateral,
    interests: group.interests,
    listingSource: group.listingSource,
    accountAddress: group.accountAddress,
  };
}

function buildAnswer(
  matches: readonly GroupMatch[],
  preferences: MatchPreferences,
  requestedCodeStatus: DeterministicMatchResult["requestedCodeStatus"],
): { answer: string; notice: string | null } {
  const unavailableNotice =
    requestedCodeStatus === "unavailable"
      ? preferences.locale === "tr"
        ? `${preferences.requestedCode} katalogda var ancak katılıma açık değil; bu nedenle önerilere eklemedim.`
        : `${preferences.requestedCode} exists in the catalog but is not open to join, so I excluded it from recommendations.`
      : requestedCodeStatus === "not-found"
        ? preferences.locale === "tr"
          ? `${preferences.requestedCode} koduyla bir grup bulamadım; bunun yerine uygun açık grupları sıraladım.`
          : `I could not find ${preferences.requestedCode}; I ranked eligible open groups instead.`
        : requestedCodeStatus === "constraint-mismatch"
          ? preferences.locale === "tr"
            ? `${preferences.requestedCode} katılıma açık ancak belirttiğin azami bütçeyi aşıyor; bu nedenle önermedim.`
            : `${preferences.requestedCode} is open but exceeds your stated budget ceiling, so I did not recommend it.`
        : null;
  const top = matches[0];
  if (!top) {
    const noMatches =
      preferences.locale === "tr"
        ? "Şu anda bu ağda katılıma uygun gerçek bir grup yok. Daha sonra tekrar dene veya yeni bir grup oluştur."
        : "There are no eligible on-chain groups on this network right now. Try again later or create a new group.";
    return { answer: unavailableNotice ? `${unavailableNotice} ${noMatches}` : noMatches, notice: unavailableNotice };
  }

  if (preferences.locale === "tr") {
    const recommendation = `${top.name} (${top.groupCode}) isteğine en yakın zincir üstü grup. ${top.contributionUsdc} USDC ${cadenceLabel(top.cadence, "tr")} katkı ve ${top.seatsAvailable} açık kontenjan sunuyor. Grup kodu herkese açık bir kimliktir ve katılım yetkisi vermez.`;
    return {
      answer: unavailableNotice ? `${unavailableNotice} ${recommendation}` : recommendation,
      notice: unavailableNotice,
    };
  }

  const recommendation = `${top.name} (${top.groupCode}) is the closest on-chain match. It offers a ${top.contributionUsdc} USDC ${cadenceLabel(top.cadence, "en")} contribution and ${top.seatsAvailable} open seats. The group code is a public identifier and grants no join authorization.`;
  return {
    answer: unavailableNotice ? `${unavailableNotice} ${recommendation}` : recommendation,
    notice: unavailableNotice,
  };
}

export function matchPublicGroups(input: MatchInput): DeterministicMatchResult {
  const preferences = parseMatchPreferences(input);
  const requestedGroup = preferences.requestedCode
    ? getPublicGroupByCode(input.groups, preferences.requestedCode)
    : null;
  const eligibleGroups = getEligiblePublicGroups(input.groups);
  // Explicit ceilings are hard constraints. Other preferences remain scored
  // tradeoffs so the fallback can still explain near matches.
  const candidates =
    preferences.contributionIsMaximum && preferences.contributionUsdc !== null
      ? eligibleGroups.filter(
          (group) => group.contributionUsdc <= (preferences.contributionUsdc as number),
        )
      : eligibleGroups;
  const requestedCodeStatus = !preferences.requestedCode
    ? null
    : !requestedGroup
      ? "not-found"
      : eligibleGroups.some((group) => group.code === requestedGroup.code)
        ? candidates.some((group) => group.code === requestedGroup.code)
          ? "eligible"
          : "constraint-mismatch"
        : "unavailable";
  const limit = Math.max(1, Math.min(5, Math.trunc(input.limit ?? 3)));

  const matches = candidates
    .map((group) => scoreGroup(group, preferences))
    .sort((left, right) => {
      if (requestedGroup && left.groupCode === requestedGroup.code) return -1;
      if (requestedGroup && right.groupCode === requestedGroup.code) return 1;
      return right.score - left.score || left.groupCode.localeCompare(right.groupCode);
    })
    .slice(0, limit);

  const responseCopy = buildAnswer(matches, preferences, requestedCodeStatus);
  return {
    locale: preferences.locale,
    preferences,
    requestedCodeStatus,
    notice: responseCopy.notice,
    matches,
    answer: responseCopy.answer,
  };
}
