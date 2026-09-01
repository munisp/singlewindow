/**
 * domainData.ts — realistic Nigerian maritime/trade reference data.
 * All identities are synthetic but structurally valid.
 */

export interface PortDef {
  name: string;
  locode: string; // UN/LOCODE
  lat: number;
  lng: number;
}

export const NG_PORTS: readonly PortDef[] = [
  { name: "Apapa Port, Lagos", locode: "NGAPP", lat: 6.449, lng: 3.359 },
  { name: "Tin Can Island Port, Lagos", locode: "NGTIN", lat: 6.435, lng: 3.348 },
  { name: "Onne Port, Rivers", locode: "NGONN", lat: 4.724, lng: 7.152 },
  { name: "Calabar Port, Cross River", locode: "NGCBQ", lat: 4.976, lng: 8.324 },
  { name: "Warri Port, Delta", locode: "NGWAR", lat: 5.517, lng: 5.75 },
  { name: "Port Harcourt Port, Rivers", locode: "NGPHC", lat: 4.778, lng: 7.0 },
];

export const NG_TERMINALS: readonly { name: string; port: string }[] = [
  { name: "APM Terminals Apapa", port: "NGAPP" },
  { name: "ENL Consortium Terminal, Apapa", port: "NGAPP" },
  { name: "Tin Can Island Container Terminal (TICT)", port: "NGTIN" },
  { name: "PTML Terminal, Tin Can", port: "NGTIN" },
  { name: "Five Star Logistics Terminal, Tin Can", port: "NGTIN" },
  { name: "Onne Multipurpose Terminal (OMT)", port: "NGONN" },
  { name: "West Africa Container Terminal (WACT), Onne", port: "NGONN" },
  { name: "Intels Logistics Base, Onne", port: "NGONN" },
  { name: "ECM Terminals, Calabar", port: "NGCBQ" },
  { name: "Calabar Free Trade Zone Terminal", port: "NGCBQ" },
  { name: "Julius Berger Terminal, Warri", port: "NGWAR" },
  { name: "BUA Ports & Terminal, Port Harcourt", port: "NGPHC" },
];

export const NG_AGENCIES: readonly {
  code: string;
  name: string;
  domain: string;
}[] = [
  { code: "NCS", name: "Nigeria Customs Service", domain: "customs.gov.ng" },
  { code: "NPA", name: "Nigerian Ports Authority", domain: "nigerianports.gov.ng" },
  { code: "NIMASA", name: "Nigerian Maritime Administration and Safety Agency", domain: "nimasa.gov.ng" },
  { code: "NIWA", name: "National Inland Waterways Authority", domain: "niwa.gov.ng" },
  { code: "FIRS", name: "Federal Inland Revenue Service", domain: "firs.gov.ng" },
  { code: "CBN", name: "Central Bank of Nigeria", domain: "cbn.gov.ng" },
  { code: "NEPC", name: "Nigerian Export Promotion Council", domain: "nepc.gov.ng" },
  { code: "NIS", name: "Nigeria Immigration Service", domain: "immigration.gov.ng" },
  { code: "PORT-HEALTH", name: "Port Health Services Nigeria", domain: "health.gov.ng" },
];

/** Compute the IMO number check digit (IMO 9074729-style, 7 digits). */
export function imoWithCheckDigit(sixDigits: string): string {
  const d = sixDigits.split("").map(Number);
  const sum = d[0] * 7 + d[1] * 6 + d[2] * 5 + d[3] * 4 + d[4] * 3 + d[5] * 2;
  return `${sixDigits}${sum % 10}`;
}

/** Nigerian MMSI: 9 digits, MID 657. */
export function mmsiNG(serial: number): string {
  return `657${String(serial).padStart(6, "0").slice(-6)}`;
}


export const VesselTypes = [
  "container_ship",
  "bulk_carrier",
  "tanker",
  "general_cargo",
  "roro",
  "fishing_vessel",
  "tug",
  "passenger",
] as const;

export const VESSEL_NAMES: readonly string[] = [
  "MV Apapa Star", "MT Bonny Light", "MV Lagos Trader", "MT Niger Delta",
  "MV Calabar Queen", "MV Warri Prince", "MT Escravos", "MV Onne Pioneer",
  "MV Gulf of Guinea", "MT Forcados", "MV Tin Can Express", "MV Kano Merchant",
  "MT Brass River", "MV Sokoto Carrier", "MV Ibadan Voyager", "MT Qua Iboe",
  "MV Benin Navigator", "MV Oyo Clipper", "MT Okrika", "MV Kaduna Spirit",
  "MV Enugu Trader", "MT Nembe Creek", "MV Jos Highland", "MV Abuja Dawn",
  "MT Oguta Lake", "MV Zaria Fortune", "MV Oshogbo Star", "MT Egbin",
  "MV Maiduguri Hope", "MV Ilorin Breeze", "MT Koko Port", "MV Akure Sun",
  "MV Bauchi Rock", "MT Sapele", "MV Minna Pearl", "MV Gusau Wind",
  "MT Burutu", "MV Yola Cross", "MV Makurdi Flow", "MT Degema",
];

/** Fixed registry of 40 synthetic-but-valid vessels operating in Nigerian waters. */
export interface VesselDef {
  name: string;
  imo: string;
  mmsi: string;
  type: string;
  flag: string;
}
export const VESSEL_REGISTRY: readonly VesselDef[] = VESSEL_NAMES.slice(0, 40).map(
  (name, i) => ({
    name,
    imo: imoWithCheckDigit(String(907000 + i * 137).slice(0, 6).padStart(6, "0")),
    mmsi: mmsiNG(100 + i),
    type: VesselTypes[i % VesselTypes.length],
    flag: i % 5 === 0 ? "NG" : ["PA", "LR", "MT", "MH"][i % 4],
  })
);

/** HS-2022 chapters actually traded through Nigerian ports. */
export const HS_2022: readonly { chapter: string; desc: string; sampleCodes: string[] }[] = [
  { chapter: "03", desc: "Fish and crustaceans", sampleCodes: ["0303.63", "0304.61", "0306.17"] },
  { chapter: "09", desc: "Coffee, tea, spices", sampleCodes: ["0901.21", "0902.30", "0910.11"] },
  { chapter: "10", desc: "Cereals", sampleCodes: ["1006.30", "1001.99", "1102.90"] },
  { chapter: "15", desc: "Animal/vegetable fats and oils", sampleCodes: ["1511.10", "1512.19", "1509.10"] },
  { chapter: "18", desc: "Cocoa and cocoa preparations", sampleCodes: ["1801.00", "1803.10", "1806.32"] },
  { chapter: "27", desc: "Mineral fuels, oils (crude, LNG)", sampleCodes: ["2709.00", "2711.11", "2710.12"] },
  { chapter: "30", desc: "Pharmaceutical products", sampleCodes: ["3004.90", "3002.15", "3006.50"] },
  { chapter: "39", desc: "Plastics and articles thereof", sampleCodes: ["3901.10", "3923.21", "3926.90"] },
  { chapter: "61", desc: "Knitted apparel", sampleCodes: ["6104.62", "6109.10", "6110.20"] },
  { chapter: "72", desc: "Iron and steel", sampleCodes: ["7208.39", "7213.91", "7227.90"] },
  { chapter: "84", desc: "Machinery and mechanical appliances", sampleCodes: ["8413.70", "8471.30", "8481.80"] },
  { chapter: "85", desc: "Electrical machinery and equipment", sampleCodes: ["8517.12", "8544.42", "8504.40"] },
  { chapter: "87", desc: "Vehicles and parts", sampleCodes: ["8703.23", "8708.29", "8711.20"] },
];

export const CARGO_DESC: readonly string[] = [
  "Frozen mackerel in 40ft reefer containers",
  "Parboiled rice, 50kg polypropylene bags",
  "Premium motor spirit (PMS) bulk",
  "Bonny light crude oil, bulk tanker",
  "Cocoa beans, Grade 1, jute bags",
  "Raw cashew nuts in shell",
  "Sesame seeds, machine cleaned",
  "Pharmaceutical generics, palletised",
  "Used vehicles (Tokunbo), RoRo",
  "Hot-rolled steel coils",
  "Polyethylene granules, 25kg bags",
  "Solar panels and inverters",
  "Knitted garments, cartons",
  "Liquefied natural gas (LNG), bulk",
  "Palm olein, flexitanks",
  "Ginger splits, dried, 50kg bags",
];

export const FIRST_NAMES = [
  "Adaeze", "Chinedu", "Ngozi", "Emeka", "Fatima", "Ibrahim", "Yetunde",
  "Olumide", "Chioma", "Uche", "Aisha", "Musa", "Bolanle", "Segun",
  "Amara", "Obinna", "Halima", "Yusuf", "Funke", "Tunde", "Kelechi",
  "Zainab", "Rotimi", "Nneka", "Suleiman", "Titilayo", "Godwin", "Efe",
  "Osas", "Kemi",
] as const;

export const LAST_NAMES = [
  "Okafor", "Adebayo", "Ibrahim", "Eze", "Olawale", "Nwosu", "Bello",
  "Okonkwo", "Adeleke", "Danjuma", "Ogunleye", "Chukwu", "Abubakar",
  "Falana", "Igwe", "Akinola", "Musa", "Ojo", "Nnaji", "Garba",
  "Bakare", "Umeh", "Sanni", "Obi", "Lawal", "Etim", "Amaechi", "Wokoma",
] as const;

export const COMPANY_SUFFIX = ["Ltd", "Nig Ltd", "Enterprises", "Logistics Ltd", "Trading Co", "Impex Ltd"] as const;
export const COMPANY_WORDS = [
  "Niger Delta", "Lagos Gateway", "Sahel", "Atlantic", "Benue", "Atlantic Crown",
  "Gulf Star", "Kainji", "Osun", "Trans-Sahara", "Nigercrest", "Lekki",
  "Bonny", "Owena", "Calabar Royal", "Jebba",
] as const;

export const BANKS_NG = [
  "Zenith Bank", "Access Bank", "GTBank", "First Bank", "UBA", "Stanbic IBTC",
] as const;

export const INSURERS_NG = [
  "Leadway Assurance", "AIICO Insurance", "AXA Mansard", "Custodian & Allied",
  "NEM Insurance", "Cornerstone Insurance",
] as const;
