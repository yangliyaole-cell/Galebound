/** Surveyed scene anchors. All geometry stays inside the playable terrain rim. */
export const GLACIAL_HORNS = [
  { x: -803, z: -971, radius: 153, rise: 350 },
  { x: -570, z: -986, radius: 148, rise: 285 },
  { x: -405, z: -994, radius: 112, rise: 215 },
] as const;
export const GLACIER_SPINE = [
  [-791, -955, 24, 450], [-778, -925, 34, 342], [-795, -895, 29, 274],
  [-804, -871, 23, 242], [-789, -850, 18, 224], [-780, -836, 13, 216],
] as const;
export const GREAT_FALL = { x: -780, z: -836, y: 216, bx: -750, bz: -792, bottom: 116, width: 21 };
export const VIADUCT = { ax: -770, az: -778, bx: -358, bz: -748, bays: 15, deck: 130, width: 7.6, pierWidth: 8.4, lowerDeck: 66 };
export const WAYGATE = { x: -39, z: 70, width: 7.6, height: 10.8 };
export const MEADOW_ROCKS = [
  [-48, 89, 4.6], [-57, 64, 3.2], [31, 64, 4.3], [-71, 45, 2.6], [49, 31, 3.7],
] as const;
export const FIELD_HAMLETS = [
  { x: 388, z: -303, n: 6 }, { x: -255, z: -94, n: 5 },
] as const;

export function sceneDensity(detail: number): { trees: number; rapids: number; flowers: number; clouds: number } {
  return detail === 0 ? { trees: 48, rapids: 22, flowers: 0, clouds: 0 }
    : detail === 1 ? { trees: 165, rapids: 65, flowers: 170, clouds: 36 }
      : { trees: 620, rapids: 180, flowers: 780, clouds: 110 };
}
