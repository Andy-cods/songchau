import { MapContainer, TileLayer, CircleMarker, Tooltip } from 'react-leaflet'
import { MapPin } from 'lucide-react'
import 'leaflet/dist/leaflet.css'

interface CountryData {
  country: string
  count: number
}

interface SupplierWorldMapProps {
  data: CountryData[]
}

const COUNTRY_COORDS: Record<string, [number, number]> = {
  china: [35.86, 104.20],
  japan: [36.20, 138.25],
  taiwan: [23.70, 120.96],
  korea: [35.91, 127.77],
  vietnam: [14.06, 108.28],
}

const COUNTRY_META: Record<string, { label: string; flag: string }> = {
  china: { label: 'China', flag: '🇨🇳' },
  japan: { label: 'Japan', flag: '🇯🇵' },
  taiwan: { label: 'Taiwan', flag: '🇹🇼' },
  korea: { label: 'Korea', flag: '🇰🇷' },
  vietnam: { label: 'Vietnam', flag: '🇻🇳' },
}

export default function SupplierWorldMap({ data }: SupplierWorldMapProps) {
  const center: [number, number] = [28, 115]
  const zoom = 3

  const maxCount = Math.max(...data.map((d) => d.count), 1)
  const getRadius = (count: number) => 10 + (count / maxCount) * 20

  return (
    <div className="rounded-xl bg-white border border-stone-200 p-6 animate-fade-in-up">
      <div className="flex items-center gap-2 mb-4">
        <MapPin className="h-5 w-5 text-amber-400" />
        <h3 className="font-display text-lg font-semibold text-stone-900">
          NCC theo quốc gia
        </h3>
      </div>
      <div className="rounded-lg overflow-hidden border border-stone-200" style={{ height: 400 }}>
        <MapContainer
          center={center}
          zoom={zoom}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom={false}
          attributionControl={false}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap"
          />
          {data.map((item) => {
            const coords = COUNTRY_COORDS[item.country]
            if (!coords || item.count === 0) return null
            const meta = COUNTRY_META[item.country]
            return (
              <CircleMarker
                key={item.country}
                center={coords}
                radius={getRadius(item.count)}
                pathOptions={{
                  color: '#d97706',
                  fillColor: '#f59e0b',
                  fillOpacity: 0.7,
                  weight: 2,
                }}
              >
                <Tooltip direction="top" permanent>
                  <span className="font-semibold text-sm">
                    {meta?.flag} {meta?.label}: {item.count}
                  </span>
                </Tooltip>
              </CircleMarker>
            )
          })}
        </MapContainer>
      </div>
    </div>
  )
}
