import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type StationDefinition = {
  cityName: string;
  stateCode: string;
  stationId: string;
  stationName: string;
  latitude: number;
  longitude: number;
  timezone: string;
  nwsOffice: string;
  seriesTickers: string[];
};

const dailyWindow = "00:00-23:59 local";
const verifiedAt = new Date("2026-06-27T00:00:00Z");

const stations: StationDefinition[] = [
  {
    cityName: "New York",
    stateCode: "NY",
    stationId: "KNYC",
    stationName: "Central Park, NY",
    latitude: 40.7794,
    longitude: -73.9692,
    timezone: "America/New_York",
    nwsOffice: "OKX",
    seriesTickers: ["HIGHNY", "KXHIGHNY", "KXHIGHNYD", "KXLOWNY", "KXLOWNYC", "KXLOWTNYC", "KXMINNYC", "MINNYC", "KXTEMPNYCH"]
  },
  {
    cityName: "Austin",
    stateCode: "TX",
    stationId: "KAUS",
    stationName: "Austin-Bergstrom International Airport",
    latitude: 30.1945,
    longitude: -97.6699,
    timezone: "America/Chicago",
    nwsOffice: "EWX",
    seriesTickers: ["HIGHAUS", "KXHIGHAUS", "KXLOWAUS", "KXLOWTAUS"]
  },
  {
    cityName: "Chicago",
    stateCode: "IL",
    stationId: "KMDW",
    stationName: "Chicago Midway, IL",
    latitude: 41.7868,
    longitude: -87.7522,
    timezone: "America/Chicago",
    nwsOffice: "LOT",
    seriesTickers: ["HIGHCHI", "KXHIGHCHI", "KXLOWCHI", "KXLOWTCHI", "KXTEMPCHIH"]
  },
  {
    cityName: "Miami",
    stateCode: "FL",
    stationId: "KMIA",
    stationName: "Miami International Airport",
    latitude: 25.7933,
    longitude: -80.2906,
    timezone: "America/New_York",
    nwsOffice: "MFL",
    seriesTickers: ["HIGHMIA", "KXHIGHMIA", "KXLOWMIA", "KXLOWTMIA", "KXTEMPMIAH"]
  },
  {
    cityName: "Los Angeles",
    stateCode: "CA",
    stationId: "KLAX",
    stationName: "Los Angeles Airport, CA",
    latitude: 33.9382,
    longitude: -118.3865,
    timezone: "America/Los_Angeles",
    nwsOffice: "LOX",
    seriesTickers: ["KXHIGHLAX", "KXLOWLAX", "KXLOWTLAX", "KXTEMPLAXH"]
  },
  {
    cityName: "Denver",
    stateCode: "CO",
    stationId: "KDEN",
    stationName: "Denver, CO",
    latitude: 39.8617,
    longitude: -104.6731,
    timezone: "America/Denver",
    nwsOffice: "BOU",
    seriesTickers: ["KXDENHIGH", "KXHIGHDEN", "KXLOWDEN", "KXLOWTDEN"]
  },
  {
    cityName: "Philadelphia",
    stateCode: "PA",
    stationId: "KPHL",
    stationName: "Philadelphia International Airport",
    latitude: 39.8733,
    longitude: -75.2267,
    timezone: "America/New_York",
    nwsOffice: "PHI",
    seriesTickers: ["KXHIGHPHIL", "KXPHILHIGH", "KXLOWPHIL", "KXLOWTPHIL"]
  },
  {
    cityName: "Boston",
    stateCode: "MA",
    stationId: "KBOS",
    stationName: "Boston Logan International Airport",
    latitude: 42.3606,
    longitude: -71.0096,
    timezone: "America/New_York",
    nwsOffice: "BOX",
    seriesTickers: ["KXHIGHTBOS", "KXLOWTBOS", "KXTEMPBOSH"]
  },
  {
    cityName: "Washington",
    stateCode: "DC",
    stationId: "KDCA",
    stationName: "Washington National Airport",
    latitude: 38.8483,
    longitude: -77.0342,
    timezone: "America/New_York",
    nwsOffice: "LWX",
    seriesTickers: ["KXHIGHTDC", "KXLOWTDC", "KXTEMPDCH"]
  },
  {
    cityName: "Atlanta",
    stateCode: "GA",
    stationId: "KATL",
    stationName: "Atlanta Hartsfield-Jackson International Airport",
    latitude: 33.6367,
    longitude: -84.4281,
    timezone: "America/New_York",
    nwsOffice: "FFC",
    seriesTickers: ["KXHIGHTATL", "KXLOWTATL"]
  },
  {
    cityName: "Dallas",
    stateCode: "TX",
    stationId: "KDFW",
    stationName: "Dallas/Fort Worth International Airport",
    latitude: 32.8975,
    longitude: -97.0378,
    timezone: "America/Chicago",
    nwsOffice: "FWD",
    seriesTickers: ["KXHIGHTDAL", "KXLOWTDAL"]
  },
  {
    cityName: "New Orleans",
    stateCode: "LA",
    stationId: "KMSY",
    stationName: "New Orleans International Airport",
    latitude: 29.9934,
    longitude: -90.258,
    timezone: "America/Chicago",
    nwsOffice: "LIX",
    seriesTickers: ["KXHIGHTNOLA", "KXLOWTNOLA"]
  },
  {
    cityName: "Houston",
    stateCode: "TX",
    stationId: "KHOU",
    stationName: "Houston Hobby Airport",
    latitude: 29.6454,
    longitude: -95.2789,
    timezone: "America/Chicago",
    nwsOffice: "HGX",
    seriesTickers: ["KXHIGHHOU", "KXHIGHOU", "KXHIGHTHOU", "KXHOUHIGH", "KXLOWTHOU"]
  },
  {
    cityName: "Oklahoma City",
    stateCode: "OK",
    stationId: "KOKC",
    stationName: "Will Rogers World Airport",
    latitude: 35.3931,
    longitude: -97.6007,
    timezone: "America/Chicago",
    nwsOffice: "OUN",
    seriesTickers: ["KXHIGHTOKC", "KXLOWTOKC"]
  },
  {
    cityName: "San Antonio",
    stateCode: "TX",
    stationId: "KSAT",
    stationName: "San Antonio International Airport",
    latitude: 29.5337,
    longitude: -98.4698,
    timezone: "America/Chicago",
    nwsOffice: "EWX",
    seriesTickers: ["KXHIGHTSATX", "KXLOWTSATX"]
  },
  {
    cityName: "Minneapolis",
    stateCode: "MN",
    stationId: "KMSP",
    stationName: "Minneapolis-St. Paul International Airport",
    latitude: 44.8848,
    longitude: -93.2223,
    timezone: "America/Chicago",
    nwsOffice: "MPX",
    seriesTickers: ["KXHIGHTMIN", "KXLOWTMIN"]
  },
  {
    cityName: "Phoenix",
    stateCode: "AZ",
    stationId: "KPHX",
    stationName: "Phoenix Sky Harbor International Airport",
    latitude: 33.4342,
    longitude: -112.0116,
    timezone: "America/Phoenix",
    nwsOffice: "PSR",
    seriesTickers: ["KXHIGHTPHX", "KXLOWTPHX"]
  },
  {
    cityName: "Seattle",
    stateCode: "WA",
    stationId: "KSEA",
    stationName: "Seattle-Tacoma International Airport",
    latitude: 47.4502,
    longitude: -122.3088,
    timezone: "America/Los_Angeles",
    nwsOffice: "SEW",
    seriesTickers: ["KXHIGHTSEA", "KXLOWTSEA"]
  },
  {
    cityName: "San Francisco",
    stateCode: "CA",
    stationId: "KSFO",
    stationName: "San Francisco International Airport",
    latitude: 37.619,
    longitude: -122.375,
    timezone: "America/Los_Angeles",
    nwsOffice: "MTR",
    seriesTickers: ["KXHIGHTSFO", "KXLOWTSFO"]
  },
  {
    cityName: "Las Vegas",
    stateCode: "NV",
    stationId: "KLAS",
    stationName: "Harry Reid International Airport",
    latitude: 36.0801,
    longitude: -115.1522,
    timezone: "America/Los_Angeles",
    nwsOffice: "VEF",
    seriesTickers: ["KXHIGHTLV", "KXLOWTLV"]
  }
];

const mappings = stations.flatMap((station) =>
  station.seriesTickers.map((seriesTicker) => ({
    seriesTicker,
    cityName: station.cityName,
    stateCode: station.stateCode,
    stationId: station.stationId,
    stationName: station.stationName,
    icaoCode: station.stationId,
    latitude: station.latitude,
    longitude: station.longitude,
    timezone: station.timezone,
    settlementSourceName: "National Weather Service Climatological Report (Daily)",
    settlementSourceUrl: `https://forecast.weather.gov/product.php?site=NWS&issuedby=${station.nwsOffice}&product=CLI`,
    dailyObservationWindow: dailyWindow,
    dailyReportTimezone: station.timezone,
    sourceConfidence: "verified",
    verifiedAt,
    notes: "Seeded station mapping for Kalshi daily/hourly temperature series. Re-check against live Kalshi contract terms if Kalshi changes settlement language."
  }))
);

async function main() {
  for (const mapping of mappings) {
    await prisma.weatherStationMapping.upsert({
      where: { id: `${mapping.seriesTicker}-${mapping.stationId}` },
      update: mapping,
      create: { id: `${mapping.seriesTicker}-${mapping.stationId}`, ...mapping }
    });
  }
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
