import type { Juror } from "./types";

const SKIN = [
  "#f2d3b8",
  "#e8bd97",
  "#d9a071",
  "#c58a5b",
  "#a96a3f",
  "#8a5230",
  "#6b3d24",
  "#4d2b18",
];

const HAIR = [
  "#1b1512",
  "#2e211a",
  "#4a2f1d",
  "#6b4423",
  "#8d6135",
  "#b8863f",
  "#d9c9a3",
  "#8f8f96",
  "#c9ccd4",
  "#5a2222",
];

const GARMENT = [
  "#243447",
  "#2f3b52",
  "#3a3f4d",
  "#4a3b52",
  "#25404a",
  "#4a3a2c",
  "#3d2f3a",
  "#2c4038",
];

/**
 * The twelve seats. Each juror is a distinct reasoning disposition — when the
 * stub engine is replaced with real agents, `archetype` + `disposition` become
 * the system prompt and `bias` disappears.
 */
export const JURORS: Juror[] = [
  {
    id: 1,
    seat: "I",
    alias: "Foreperson",
    archetype: "Procedural",
    disposition:
      "Weighs the burden of proof above all. Asks whether the standard was actually met, not whether the story is plausible.",
    bias: -0.35,
    avatar: a(1, 5, 0, 0, 0, true, false, false),
  },
  {
    id: 2,
    seat: "II",
    alias: "Sceptic",
    archetype: "Adversarial",
    disposition:
      "Assumes every account is shaped by self-interest. Hunts for the gap between what is claimed and what is shown.",
    bias: -0.55,
    avatar: a(2, 0, 1, 1, 1, false, true, false),
  },
  {
    id: 3,
    seat: "III",
    alias: "Empath",
    archetype: "Narrative",
    disposition:
      "Reads motive and circumstance. Cares why a person acted, not only what the record says they did.",
    bias: 0.15,
    avatar: a(3, 3, 6, 2, 2, false, false, true),
  },
  {
    id: 4,
    seat: "IV",
    alias: "Statistician",
    archetype: "Quantitative",
    disposition:
      "Converts everything to base rates and likelihood ratios. Distrusts vivid detail and coincidence alike.",
    bias: -0.1,
    avatar: a(4, 1, 2, 3, 3, true, false, false),
  },
  {
    id: 5,
    seat: "V",
    alias: "Pragmatist",
    archetype: "Consequential",
    disposition:
      "Thinks about what the finding does in the world. Prefers the reading that survives contact with reality.",
    bias: 0.3,
    avatar: a(5, 4, 3, 4, 4, false, true, false),
  },
  {
    id: 6,
    seat: "VI",
    alias: "Literalist",
    archetype: "Textual",
    disposition:
      "Holds to the exact wording of the charge and the exhibits. Refuses to fill silences with inference.",
    bias: -0.2,
    avatar: a(6, 6, 4, 5, 5, true, false, false),
  },
  {
    id: 7,
    seat: "VII",
    alias: "Investigator",
    archetype: "Forensic",
    disposition:
      "Rebuilds the timeline minute by minute and tests whether the physical evidence can bear the weight put on it.",
    bias: 0.4,
    avatar: a(7, 2, 5, 6, 6, false, false, false),
  },
  {
    id: 8,
    seat: "VIII",
    alias: "Dissenter",
    archetype: "Contrarian",
    disposition:
      "Argues the unpopular position on principle, to see whether the consensus can actually defend itself.",
    bias: 0.55,
    avatar: a(8, 7, 7, 7, 0, true, true, false),
  },
  {
    id: 9,
    seat: "IX",
    alias: "Elder",
    archetype: "Experiential",
    disposition:
      "Compares this case to a long memory of others. Slow to be surprised, slow to be moved.",
    bias: 0.05,
    avatar: a(9, 1, 8, 0, 1, true, true, false),
  },
  {
    id: 10,
    seat: "X",
    alias: "Technician",
    archetype: "Systems",
    disposition:
      "Interrogates the chain of custody, the instruments, the logs. Believes process failures explain most anomalies.",
    bias: -0.45,
    avatar: a(10, 5, 9, 1, 2, false, false, true),
  },
  {
    id: 11,
    seat: "XI",
    alias: "Moralist",
    archetype: "Normative",
    disposition:
      "Asks what a reasonable person owed to whom, and whether that duty was discharged.",
    bias: 0.25,
    avatar: a(11, 4, 0, 2, 3, false, false, false),
  },
  {
    id: 12,
    seat: "XII",
    alias: "Quiet One",
    archetype: "Holistic",
    disposition:
      "Says little, then names the single fact the rest of the room has been talking around.",
    bias: -0.15,
    avatar: a(12, 6, 1, 3, 4, false, false, true),
  },
];

function a(
  _id: number,
  skin: number,
  hairStyle: number,
  hair: number,
  garment: number,
  glasses: boolean,
  facialHair: boolean,
  earrings: boolean,
) {
  return {
    skin: SKIN[skin % SKIN.length],
    hair: HAIR[hair % HAIR.length],
    hairStyle,
    garment: GARMENT[garment % GARMENT.length],
    accent: "#c9a227",
    glasses,
    facialHair,
    earrings,
  };
}

export function getJuror(id: number): Juror | undefined {
  return JURORS.find((j) => j.id === id);
}

/** URL-safe handle for a juror's own page, e.g. "the-quiet-one". */
export function slugFor(juror: Juror): string {
  return juror.alias.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function getJurorBySlug(slug: string): Juror | undefined {
  return JURORS.find((j) => slugFor(j) === slug);
}
