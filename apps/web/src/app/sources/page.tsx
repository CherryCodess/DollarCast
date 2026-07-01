import { Card } from "@dollarcast/ui";

const sources = [
  ["Kalshi market data", "Live public market, series, event, and order-book information.", "https://external-api.kalshi.com/trade-api/v2"],
  ["Kalshi settlement rules", "Contract terms define the exact measurement, settlement source, and observation window.", "https://docs.kalshi.com"],
  ["NOAA National Blend of Models", "NBM: blended NOAA forecast baseline.", "https://noaa-nbm-grib2-pds.s3.amazonaws.com"],
  ["NOAA HRRR", "HRRR: high-resolution short-term forecast.", "https://noaa-hrrr-bdp-pds.s3.amazonaws.com"],
  ["National Weather Service forecasts", "NWS: official forecast context.", "https://api.weather.gov"],
  ["Aviation Weather Center METAR observations", "METAR: current station observation.", "https://aviationweather.gov/api/data"]
];

export default function SourcesPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Sources</h1>
        <p className="mt-1 text-sm text-muted">Every market detail page links to the specific available source files or pages used for that estimate.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {sources.map(([title, body, url]) => (
          <Card key={title}>
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-2 text-sm text-muted">{body}</p>
            <a className="mt-3 inline-block text-sm text-source" href={url}>{url}</a>
          </Card>
        ))}
      </div>
    </div>
  );
}
