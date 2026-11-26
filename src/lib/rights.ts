import type { AssetReference } from "../types";

export type Rights = NonNullable<AssetReference["rights"]>;
export const RIGHTS: { id: Rights; label: string; licence: string }[] = [
  { id: "mine", label: "I made it or own it", licence: "Made or owned by the person who imported it." },
  { id: "licensed", label: "Licensed to me", licence: "Licensed to the person who imported it. Keep the licence." },
  { id: "stock", label: "Stock or free licence", licence: "Stock or free-licence file. Check the licence covers video use." },
];
export const rightsLabel = (r: AssetReference["rights"]) => RIGHTS.find((x) => x.id === r)?.label ?? "Not confirmed";
/** An imported file the person has not said anything about yet. Files made through a provider are not counted: their terms come from the provider. */
export const needsRights = (a: AssetReference) => a.provenance.provider === "import" && !a.rights;
export function setRights(a: AssetReference, r: Rights | undefined): AssetReference {
  const licence = RIGHTS.find((x) => x.id === r)?.licence ?? "Imported by you. Make sure you have the rights to use it.";
  return { ...a, rights: r, provenance: { ...a.provenance, licence } };
}
