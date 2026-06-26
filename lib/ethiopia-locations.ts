/**
 * Ethiopia regions, zones, and cities data source.
 * Used for Region / Zone / City dropdowns in registration (Step 4).
 */

export interface EthiopiaCity {
  id: string;
  name: string;
  altNames: string[];
}

export interface EthiopiaZone {
  id: string;
  name: string;
  type: "zone";
  cities: EthiopiaCity[];
}

export interface EthiopiaRegion {
  id: string;
  name: string;
  type: "region";
  cities?: EthiopiaCity[];
  zones?: EthiopiaZone[];
}

export const ETHIOPIA_LOCATIONS: EthiopiaRegion[] = [
  {
    id: "addis-ababa",
    name: "Addis Ababa",
    type: "region",
    cities: [
      { id: "addis-ababa", name: "Addis Ababa", altNames: ["Finfinne"] },
    ],
  },
  {
    id: "afar",
    name: "Afar",
    type: "region",
    zones: [
      {
        id: "awsi-rasu",
        name: "Awsi Rasu",
        type: "zone",
        cities: [
          { id: "semera", name: "Semera", altNames: [] },
          { id: "asaita", name: "Asaita", altNames: [] },
          { id: "logia", name: "Logia", altNames: [] },
        ],
      },
      {
        id: "kilbet-rasu",
        name: "Kilbet Rasu",
        type: "zone",
        cities: [{ id: "abala", name: "Abala", altNames: [] }],
      },
      {
        id: "gabi-rasu",
        name: "Gabi Rasu",
        type: "zone",
        cities: [
          { id: "awash", name: "Awash", altNames: [] },
          { id: "gewane", name: "Gewane", altNames: [] },
        ],
      },
    ],
  },
  {
    id: "amhara",
    name: "Amhara",
    type: "region",
    zones: [
      {
        id: "east-gojjam",
        name: "East Gojjam",
        type: "zone",
        cities: [
          { id: "debre-markos", name: "Debre Markos", altNames: [] },
          { id: "bichena", name: "Bichena", altNames: [] },
        ],
      },
      {
        id: "west-gojjam",
        name: "West Gojjam",
        type: "zone",
        cities: [
          { id: "finote-selam", name: "Finote Selam", altNames: [] },
          { id: "bure", name: "Bure", altNames: [] },
        ],
      },
      {
        id: "central-gondar",
        name: "Central Gondar",
        type: "zone",
        cities: [{ id: "gondar", name: "Gondar", altNames: [] }],
      },
      {
        id: "north-gondar",
        name: "North Gondar",
        type: "zone",
        cities: [{ id: "debark", name: "Debark", altNames: [] }],
      },
      {
        id: "south-gondar",
        name: "South Gondar",
        type: "zone",
        cities: [{ id: "debre-tabor", name: "Debre Tabor", altNames: [] }],
      },
      {
        id: "north-wollo",
        name: "North Wollo",
        type: "zone",
        cities: [
          { id: "weldiya", name: "Weldiya", altNames: ["Woldia"] },
          { id: "kobo", name: "Kobo", altNames: [] },
        ],
      },
      {
        id: "south-wollo",
        name: "South Wollo",
        type: "zone",
        cities: [
          { id: "dessie", name: "Dessie", altNames: ["Dese"] },
          { id: "kombolcha", name: "Kombolcha", altNames: [] },
        ],
      },
      {
        id: "north-shewa-amhara",
        name: "North Shewa",
        type: "zone",
        cities: [
          { id: "debre-berhan", name: "Debre Berhan", altNames: [] },
          { id: "shewa-robit", name: "Shewa Robit", altNames: [] },
        ],
      },
      {
        id: "wag-hemra",
        name: "Wag Hemra",
        type: "zone",
        cities: [{ id: "sekota", name: "Sekota", altNames: [] }],
      },
      {
        id: "wolkait-tegede",
        name: "Wolkait Tegede",
        type: "zone",
        cities: [
          { id: "humera", name: "Humera", altNames: ["Himora"] },
          { id: "dansha", name: "Dansha", altNames: [] },
        ],
      },
      {
        id: "agew-awi",
        name: "Agew Awi",
        type: "zone",
        cities: [
          { id: "injibara", name: "Injibara", altNames: [] },
          { id: "dangila", name: "Dangila", altNames: [] },
        ],
      },
      {
        id: "oromia-zone",
        name: "Oromia Zone",
        type: "zone",
        cities: [{ id: "kemise", name: "Kemise", altNames: [] }],
      },
    ],
    cities: [{ id: "bahir-dar", name: "Bahir Dar", altNames: [] }],
  },
  {
    id: "benishangul-gumuz",
    name: "Benishangul-Gumuz",
    type: "region",
    zones: [
      {
        id: "asosa",
        name: "Asosa",
        type: "zone",
        cities: [
          { id: "asosa-city", name: "Asosa", altNames: ["Assosa"] },
        ],
      },
      {
        id: "metekel",
        name: "Metekel",
        type: "zone",
        cities: [
          { id: "gilgel-beles", name: "Gilgel Beles", altNames: [] },
          { id: "chagni", name: "Chagni", altNames: [] },
        ],
      },
      {
        id: "kamashi",
        name: "Kamashi",
        type: "zone",
        cities: [{ id: "kamashi-city", name: "Kamashi", altNames: [] }],
      },
    ],
  },
  {
    id: "central-ethiopia",
    name: "Central Ethiopia",
    type: "region",
    zones: [
      {
        id: "gurage",
        name: "Gurage",
        type: "zone",
        cities: [
          { id: "welkite", name: "Welkite", altNames: ["Wolkite"] },
          { id: "butajira", name: "Butajira", altNames: [] },
        ],
      },
      {
        id: "hadiya",
        name: "Hadiya",
        type: "zone",
        cities: [
          { id: "hosanna", name: "Hosanna", altNames: ["Hosaena"] },
        ],
      },
      {
        id: "silte",
        name: "Silte",
        type: "zone",
        cities: [{ id: "worabe", name: "Worabe", altNames: [] }],
      },
      {
        id: "kambaata",
        name: "Kambaata",
        type: "zone",
        cities: [{ id: "durame", name: "Durame", altNames: [] }],
      },
      {
        id: "halaba",
        name: "Halaba",
        type: "zone",
        cities: [
          { id: "halaba-kulito", name: "Halaba Kulito", altNames: ["Alaba Kulito"] },
        ],
      },
    ],
  },
  {
    id: "dire-dawa",
    name: "Dire Dawa",
    type: "region",
    cities: [{ id: "dire-dawa", name: "Dire Dawa", altNames: [] }],
  },
  {
    id: "gambella",
    name: "Gambella",
    type: "region",
    zones: [
      {
        id: "anuak",
        name: "Anuak",
        type: "zone",
        cities: [
          { id: "gambella-city", name: "Gambella", altNames: [] },
          { id: "abobo", name: "Abobo", altNames: [] },
        ],
      },
      {
        id: "nuer",
        name: "Nuer",
        type: "zone",
        cities: [{ id: "itang", name: "Itang", altNames: [] }],
      },
      {
        id: "majang",
        name: "Majang",
        type: "zone",
        cities: [{ id: "meti", name: "Meti", altNames: [] }],
      },
    ],
  },
  {
    id: "harari",
    name: "Harari",
    type: "region",
    cities: [{ id: "harar", name: "Harar", altNames: ["Harer"] }],
  },
  {
    id: "oromia",
    name: "Oromia",
    type: "region",
    zones: [
      {
        id: "east-shewa",
        name: "East Shewa",
        type: "zone",
        cities: [
          { id: "adama", name: "Adama", altNames: ["Nazret"] },
          { id: "bishoftu", name: "Bishoftu", altNames: ["Debre Zeyit"] },
          { id: "batu", name: "Batu", altNames: ["Ziway"] },
          { id: "metehara", name: "Metehara", altNames: [] },
        ],
      },
      {
        id: "west-shewa",
        name: "West Shewa",
        type: "zone",
        cities: [
          { id: "ambo", name: "Ambo", altNames: [] },
          { id: "holeta", name: "Holeta", altNames: [] },
        ],
      },
      {
        id: "north-shewa-oromia",
        name: "North Shewa",
        type: "zone",
        cities: [{ id: "fiche", name: "Fiche", altNames: ["Fitche"] }],
      },
      {
        id: "southwest-shewa",
        name: "Southwest Shewa",
        type: "zone",
        cities: [{ id: "waliso", name: "Waliso", altNames: ["Wolisso"] }],
      },
      {
        id: "arsi",
        name: "Arsi",
        type: "zone",
        cities: [
          { id: "asella", name: "Asella", altNames: ["Asela"] },
          { id: "bekoji", name: "Bekoji", altNames: [] },
        ],
      },
      {
        id: "west-arsi",
        name: "West Arsi",
        type: "zone",
        cities: [
          { id: "shashamane", name: "Shashamane", altNames: [] },
          { id: "negele-arsi", name: "Negele Arsi", altNames: ["Arsi Negele"] },
        ],
      },
      {
        id: "bale",
        name: "Bale",
        type: "zone",
        cities: [
          { id: "robe", name: "Robe", altNames: ["Bale Robe"] },
          { id: "goba", name: "Goba", altNames: [] },
        ],
      },
      {
        id: "east-bale",
        name: "East Bale",
        type: "zone",
        cities: [{ id: "ginir", name: "Ginir", altNames: ["Ghinir"] }],
      },
      {
        id: "borena",
        name: "Borena",
        type: "zone",
        cities: [
          { id: "yabelo", name: "Yabelo", altNames: [] },
          { id: "mega", name: "Mega", altNames: [] },
        ],
      },
      {
        id: "guji",
        name: "Guji",
        type: "zone",
        cities: [
          { id: "negele-borana", name: "Negele Borana", altNames: ["Negele"] },
        ],
      },
      {
        id: "west-guji",
        name: "West Guji",
        type: "zone",
        cities: [
          { id: "bule-hora", name: "Bule Hora", altNames: ["Hagere Mariam"] },
        ],
      },
      {
        id: "jimma",
        name: "Jimma",
        type: "zone",
        cities: [
          { id: "jimma-city", name: "Jimma", altNames: [] },
          { id: "agaro", name: "Agaro", altNames: [] },
        ],
      },
      {
        id: "illubabor",
        name: "Illubabor",
        type: "zone",
        cities: [{ id: "metu", name: "Metu", altNames: ["Mattu"] }],
      },
      {
        id: "buno-bedele",
        name: "Buno Bedele",
        type: "zone",
        cities: [{ id: "bedele", name: "Bedele", altNames: [] }],
      },
      {
        id: "east-welega",
        name: "East Welega",
        type: "zone",
        cities: [{ id: "nekemte", name: "Nekemte", altNames: ["Lekemt"] }],
      },
      {
        id: "west-welega",
        name: "West Welega",
        type: "zone",
        cities: [{ id: "gimbi", name: "Gimbi", altNames: [] }],
      },
      {
        id: "kelam-welega",
        name: "Kelam Welega",
        type: "zone",
        cities: [
          { id: "dambi-dollo", name: "Dambi Dollo", altNames: ["Dembi Dolo"] },
        ],
      },
      {
        id: "horo-guduru-welega",
        name: "Horo Guduru Welega",
        type: "zone",
        cities: [{ id: "shambu", name: "Shambu", altNames: [] }],
      },
      {
        id: "east-hararghe",
        name: "East Hararghe",
        type: "zone",
        cities: [
          { id: "haramaya", name: "Haramaya", altNames: ["Alemaya"] },
          { id: "awaday", name: "Awaday", altNames: [] },
          { id: "babile", name: "Babile", altNames: [] },
        ],
      },
      {
        id: "west-hararghe",
        name: "West Hararghe",
        type: "zone",
        cities: [
          { id: "chiro", name: "Chiro", altNames: ["Asebe Teferi"] },
          { id: "hirna", name: "Hirna", altNames: [] },
        ],
      },
      {
        id: "finfinne-special-zone",
        name: "Finfinne Special Zone",
        type: "zone",
        cities: [
          { id: "sebeta", name: "Sebeta", altNames: [] },
          { id: "burayu", name: "Burayu", altNames: [] },
          { id: "sululta", name: "Sululta", altNames: [] },
          { id: "gelan", name: "Gelan", altNames: [] },
          { id: "dukemu", name: "Dukemu", altNames: ["Dukam"] },
        ],
      },
    ],
  },
  {
    id: "sidama",
    name: "Sidama",
    type: "region",
    cities: [
      { id: "hawassa", name: "Hawassa", altNames: ["Awassa"] },
      { id: "yirgalem", name: "Yirgalem", altNames: ["Irgalem"] },
      { id: "aleta-wendo", name: "Aleta Wendo", altNames: [] },
    ],
  },
  {
    id: "somali",
    name: "Somali",
    type: "region",
    zones: [
      {
        id: "fafan",
        name: "Fafan",
        type: "zone",
        cities: [
          { id: "jijiga", name: "Jijiga", altNames: [] },
          { id: "tog-wajale", name: "Tog Wajale", altNames: ["Wajaale"] },
        ],
      },
      {
        id: "sitti",
        name: "Sitti",
        type: "zone",
        cities: [
          { id: "shinile", name: "Shinile", altNames: [] },
          { id: "erergota", name: "Erergota", altNames: [] },
        ],
      },
      {
        id: "shebelle",
        name: "Shebelle",
        type: "zone",
        cities: [
          { id: "gode", name: "Gode", altNames: [] },
          { id: "kelafo", name: "Kelafo", altNames: [] },
        ],
      },
      {
        id: "jarar",
        name: "Jarar",
        type: "zone",
        cities: [
          { id: "degehabur", name: "Degehabur", altNames: ["Dhagaxbuur"] },
          { id: "aware", name: "Aware", altNames: [] },
        ],
      },
      {
        id: "korahe",
        name: "Korahe",
        type: "zone",
        cities: [
          { id: "kebridehar", name: "Kebridehar", altNames: ["Qabridahare"] },
        ],
      },
      {
        id: "dollo",
        name: "Dollo",
        type: "zone",
        cities: [{ id: "warder", name: "Warder", altNames: ["Wardheer"] }],
      },
      {
        id: "afder",
        name: "Afder",
        type: "zone",
        cities: [
          { id: "hargele", name: "Hargele", altNames: [] },
          { id: "bare", name: "Bare", altNames: [] },
        ],
      },
      {
        id: "liben",
        name: "Liben",
        type: "zone",
        cities: [{ id: "filtu", name: "Filtu", altNames: [] }],
      },
      {
        id: "dawa",
        name: "Dawa",
        type: "zone",
        cities: [{ id: "moyale", name: "Moyale", altNames: [] }],
      },
      {
        id: "nogob",
        name: "Nogob",
        type: "zone",
        cities: [{ id: "fik", name: "Fik", altNames: ["Fiq"] }],
      },
    ],
  },
  {
    id: "south-ethiopia",
    name: "South Ethiopia",
    type: "region",
    zones: [
      {
        id: "wolayita",
        name: "Wolayita",
        type: "zone",
        cities: [
          { id: "sodo", name: "Sodo", altNames: ["Wolaita Sodo"] },
          { id: "boditi", name: "Boditi", altNames: [] },
        ],
      },
      {
        id: "gamo",
        name: "Gamo",
        type: "zone",
        cities: [
          { id: "arba-minch", name: "Arba Minch", altNames: [] },
          { id: "chencha", name: "Chencha", altNames: [] },
        ],
      },
      {
        id: "gofa",
        name: "Gofa",
        type: "zone",
        cities: [{ id: "sawla", name: "Sawla", altNames: [] }],
      },
      {
        id: "south-omo",
        name: "South Omo",
        type: "zone",
        cities: [
          { id: "jinka", name: "Jinka", altNames: [] },
          { id: "turmi", name: "Turmi", altNames: [] },
        ],
      },
      {
        id: "konso",
        name: "Konso",
        type: "zone",
        cities: [
          { id: "karat", name: "Karat", altNames: ["Karat-Konso"] },
        ],
      },
      {
        id: "ari",
        name: "Ari",
        type: "zone",
        cities: [{ id: "gazer", name: "Gazer", altNames: [] }],
      },
    ],
  },
  {
    id: "south-west-ethiopia-peoples",
    name: "South West Ethiopia Peoples'",
    type: "region",
    zones: [
      {
        id: "keffa",
        name: "Keffa",
        type: "zone",
        cities: [{ id: "bonga", name: "Bonga", altNames: [] }],
      },
      {
        id: "bench-sheko",
        name: "Bench Sheko",
        type: "zone",
        cities: [
          { id: "mizan-teferi", name: "Mizan Teferi", altNames: ["Mizan Aman"] },
        ],
      },
      {
        id: "sheka",
        name: "Sheka",
        type: "zone",
        cities: [
          { id: "tepi", name: "Tepi", altNames: [] },
          { id: "masha", name: "Masha", altNames: [] },
        ],
      },
      {
        id: "dawro",
        name: "Dawro",
        type: "zone",
        cities: [
          { id: "tercha", name: "Tercha", altNames: ["Tarcha"] },
        ],
      },
      {
        id: "west-omo",
        name: "West Omo",
        type: "zone",
        cities: [{ id: "jemu", name: "Jemu", altNames: [] }],
      },
      {
        id: "konta",
        name: "Konta",
        type: "zone",
        cities: [{ id: "ameya", name: "Ameya", altNames: [] }],
      },
    ],
  },
  {
    id: "tigray",
    name: "Tigray",
    type: "region",
    zones: [
      {
        id: "mekelle-special-zone",
        name: "Mekelle Special Zone",
        type: "zone",
        cities: [
          { id: "mekelle", name: "Mekelle", altNames: ["Meqele"] },
        ],
      },
      {
        id: "central-tigray",
        name: "Central Tigray",
        type: "zone",
        cities: [
          { id: "aksum", name: "Aksum", altNames: ["Axum"] },
          { id: "adwa", name: "Adwa", altNames: [] },
        ],
      },
      {
        id: "east-tigray",
        name: "East Tigray",
        type: "zone",
        cities: [
          { id: "adigrat", name: "Adigrat", altNames: [] },
          { id: "wukro", name: "Wukro", altNames: [] },
        ],
      },
      {
        id: "north-western-tigray",
        name: "North Western Tigray",
        type: "zone",
        cities: [
          { id: "shire", name: "Shire", altNames: ["Inda Selassie"] },
          { id: "shiraro", name: "Shiraro", altNames: [] },
        ],
      },
      {
        id: "south-tigray",
        name: "South Tigray",
        type: "zone",
        cities: [
          { id: "maychew", name: "Maychew", altNames: ["Maichew"] },
          { id: "alamata", name: "Alamata", altNames: [] },
          { id: "korem", name: "Korem", altNames: [] },
        ],
      },
      {
        id: "south-eastern-tigray",
        name: "South Eastern Tigray",
        type: "zone",
        cities: [{ id: "samre", name: "Samre", altNames: [] }],
      },
    ],
  },
];

// Derived lookups for dropdowns (same shape as before; only data source changes)

export const ETHIOPIAN_REGIONS: { value: string; label: string }[] =
  ETHIOPIA_LOCATIONS.map((r) => ({ value: r.id, label: r.name }));

export const ZONES_BY_REGION: Record<string, { value: string; label: string }[]> = {};
export const CITIES_BY_REGION: Record<string, { value: string; label: string }[]> = {};

ETHIOPIA_LOCATIONS.forEach((region) => {
  if (region.zones?.length) {
    ZONES_BY_REGION[region.id] = region.zones.map((z) => ({
      value: z.id,
      label: z.name,
    }));
  } else {
    ZONES_BY_REGION[region.id] = [];
  }

  const cityList: EthiopiaCity[] = [...(region.cities ?? [])];
  region.zones?.forEach((z) => cityList.push(...(z.cities ?? [])));
  CITIES_BY_REGION[region.id] = cityList
    .map((c) => ({ value: c.id, label: c.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
});

/**
 * Returns the zone id that contains the given city in the given region, or null if the city
 * is a top-level region city (no zone) or not found.
 */
export function getZoneIdForCity(regionId: string, cityId: string): string | null {
  const region = ETHIOPIA_LOCATIONS.find((r) => r.id === regionId);
  if (!region?.zones?.length) return null;
  const zone = region.zones.find((z) =>
    z.cities?.some((c) => c.id === cityId)
  );
  return zone?.id ?? null;
}
