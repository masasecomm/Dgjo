export const SOUTH_AFRICAN_PROVINCES = [
  "Eastern Cape",
  "Free State",
  "Gauteng",
  "KwaZulu-Natal",
  "Limpopo",
  "Mpumalanga",
  "North West",
  "Northern Cape",
  "Western Cape"
];

export const PROVINCE_CRESTS = Object.freeze({
  "Eastern Cape": "/province-eastern-cape.png",
  "Free State": "/province-free-state.png",
  Gauteng: "/province-gauteng.png",
  "KwaZulu-Natal": "/province-kwazulu-natal.png",
  Limpopo: "/province-limpopo.png",
  Mpumalanga: "/province-mpumalanga.png",
  "North West": "/province-north-west.png",
  "Northern Cape": "/province-northern-cape.png",
  "Western Cape": "/province-western-cape.png"
});

const provinceNamesByKey = new Map(
  SOUTH_AFRICAN_PROVINCES.map(name => [name.toLowerCase().replace(/[^a-z]/g, ""), name])
);

export function normalizeProvince(value) {
  const key = String(value ?? "").toLocaleLowerCase("en-ZA").replace(/[^a-z]/g, "");
  return provinceNamesByKey.get(key) ?? "";
}
