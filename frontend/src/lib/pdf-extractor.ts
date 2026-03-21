
/**
 * @fileOverview Core logic for Room Aggregation and Section Classification.
 */

export interface CabinetItem {
  code: string;
  qty: number;
  type: string;
}

export interface RoomData {
  room_name: string;
  room_type: string;
  sections: {
    [key: string]: CabinetItem[];
  };
}

/**
 * Standardizes raw extraction data into the professional estimator format.
 */
export function aggregateRooms(rawRooms: any[]): RoomData[] {
  return rawRooms.map(room => ({
    room_name: room.room_name || 'Standard Kitchen',
    room_type: room.room_type || 'Kitchen',
    sections: room.sections || {
      'Wall Cabinets': [],
      'Base Cabinets': [],
      'Tall Cabinets': [],
      'Vanity Cabinets': [],
      'Hardware': []
    }
  }));
}
