import { MapContainer, TileLayer, CircleMarker, Tooltip } from 'react-leaflet'
import { Users } from 'lucide-react'
import 'leaflet/dist/leaflet.css'

interface ProvinceData {
  province: string
  count: number
}

interface CustomerVietnamMapProps {
  data: ProvinceData[]
}

const PROVINCE_COORDS: Record<string, [number, number]> = {
  'Vinh Phuc': [21.31, 105.60],
  'Bac Ninh': [21.19, 106.08],
  'Bac Giang': [21.29, 106.20],
  'Ha Noi': [21.03, 105.85],
  'Hai Phong': [20.84, 106.69],
  'Hai Duong': [20.94, 106.31],
  'Hung Yen': [20.65, 106.05],
  'Thai Nguyen': [21.59, 105.84],
  'Quang Ninh': [21.01, 107.29],
}

function normalizeProvince(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0111/g, 'd')
    .replace(/\u0110/g, 'D')
}

export default function CustomerVietnamMap({ data }: CustomerVietnamMapProps) {
  const center: [number, number] = [21.1, 106.1]
  const zoom = 8

  const maxCount = Math.max(...data.map((d) => d.count), 1)
  const getRadius = (count: number) => 8 + (count / maxCount) * 22

  return (
    <div className="rounded-xl bg-white border border-stone-200 p-6 animate-fade-in-up">
      <div className="flex items-center gap-2 mb-4">
        <Users className="h-5 w-5 text-red-400" />
        <h3 className="font-display text-lg font-semibold text-stone-900">
          Khách hàng theo tỉnh
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
            const normalized = normalizeProvince(item.province)
            const coords = PROVINCE_COORDS[normalized]
            if (!coords || item.count === 0) return null
            return (
              <CircleMarker
                key={item.province}
                center={coords}
                radius={getRadius(item.count)}
                pathOptions={{
                  color: '#dc2626',
                  fillColor: '#ef4444',
                  fillOpacity: 0.65,
                  weight: 2,
                }}
              >
                <Tooltip direction="top" permanent>
                  <span className="font-semibold text-sm">
                    {item.province}: {item.count}
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
