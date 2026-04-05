"use client";

import { MapContainer, Marker, Polyline, Popup, TileLayer } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const base = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

export function TrackMap(props: {
  dest: { lat: number; lng: number };
  ambulance: { lat: number; lng: number };
  route?: [number, number][];
}) {
  const { dest, ambulance, route = [] } = props;
  const center: [number, number] = [
    (dest.lat + ambulance.lat) / 2,
    (dest.lng + ambulance.lng) / 2,
  ];

  const linePositions: [number, number][] =
    route.length >= 2 ? route : [[ambulance.lat, ambulance.lng], [dest.lat, dest.lng]];

  return (
    <MapContainer
      center={center}
      zoom={13}
      className="z-0 h-[min(420px,50vh)] w-full rounded-2xl border border-[var(--cc-border)]"
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {linePositions.length >= 2 && (
        <Polyline
          positions={linePositions}
          pathOptions={{ color: "#34d399", weight: 4, opacity: 0.85 }}
        />
      )}
      <Marker position={[ambulance.lat, ambulance.lng]} icon={base}>
        <Popup>Ambulance / responder (simulated)</Popup>
      </Marker>
      <Marker position={[dest.lat, dest.lng]} icon={base}>
        <Popup>Your location</Popup>
      </Marker>
    </MapContainer>
  );
}
