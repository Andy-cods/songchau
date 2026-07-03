// PR-1 (Thang 2026-05-13): Driver type contract — shared between
// DriverPicker, DriverManagementModal, and the deliveries page.

export interface DriverRecord {
  id: number;
  full_name: string;
  phone?: string | null;
  cccd_number?: string | null;
  license_plate?: string | null;
  vehicle_type?: string | null;
  driver_notes?: string | null;
  is_active?: boolean;
  has_cccd_image?: boolean;
  has_plate_image?: boolean;
}

// Minimum delivery contract DriverPicker needs — keeps the picker
// decoupled from the full DeliveryRecord interface that lives in the page.
export interface DriverPickerDelivery {
  id: number;
  driver_id?: number | null;
  driver_name?: string | null;
  driver_phone?: string | null;
  driver_license_plate?: string | null;
  driver_vehicle_type?: string | null;
}
