// Roblox asset ids uploaded by tools/roblox-upload-textures.mjs and tools/roblox-upload-meshes.mjs (creator user
// 11041117443; public images and meshes any experience can use). Shipped so every export (editor, MCP, tools) references
// them; a local work/roblox/asset-ids.json adds or overrides texture ids. Regenerate: node tools/roblox-sync-assets.mjs.
/** Texture key (sheet file, "sheet.png#N" cell, "@beam-..." cross-section) -> image asset id. */
export const ROBLOX_TEXTURE_IDS: Record<string, string> = {
  "flame-tongue-a.png": "127470453469193",
  "flame-tongue-b.png": "89899451779884",
  "smoke-puff.png": "135025588909429",
  "spark-streak.png": "93258307466321",
  "soft-glow.png": "86089172429711",
  "ripple-ring.png": "139695300636870",
  "droplet.png": "132014910294281",
  "foam.png": "124212045056605",
  "bubble.png": "81664714915244",
  "electric-arc.png": "111811542283919",
  "dark-wisp.grey.png": "121179296112652",
  "electric-arc.grey.png": "124801580055821",
  "fire-puff.grey.png": "93960145015221",
  "flame-tongue-a.grey.png": "110852479810261",
  "flame-tongue-b.grey.png": "97643470291896",
  "lightning-charge.grey.png": "103415269931540",
  "spark-streak.grey.png": "140072678444502",
  "@beam-soft-100.png": "90940571621272",
  "@beam-soft-25.png": "136837826898900",
  "electric-arc.png#line": "100448292128438",
  "electric-arc.grey.png#line": "138165762936136",
  "smoke-puff.png#line": "73465487891682",
  "star-ray.png": "121324635803490",
  "sim-fireball.png": "75375651965638",
  "sim-fireball.grey.png": "115223656075119",
  "soft-glow.png#1": "137167295111687",
  "soft-glow.png#2": "94729818020015",
  "soft-glow.png#3": "99326131610452"
};
/** Built-in mesh kind -> uploaded Model and the MeshId of its one MeshPart. */
export const ROBLOX_MESH_IDS: Record<string, { model: string; mesh: string }> = {
  "crystal": {
    "model": "126475492250764",
    "mesh": "89366460471846"
  },
  "shard": {
    "model": "138013968707837",
    "mesh": "107063688087145"
  },
  "rock-a": {
    "model": "89356058672201",
    "mesh": "71810588378060"
  },
  "rock-b": {
    "model": "135713421608506",
    "mesh": "124637090027035"
  },
  "rock-c": {
    "model": "112512544232634",
    "mesh": "135013974561513"
  },
  "orb": {
    "model": "94310299394761",
    "mesh": "117619380214993"
  },
  "cone": {
    "model": "88380578150439",
    "mesh": "120713844024476"
  },
  "crystal-b": {
    "model": "129207495931223",
    "mesh": "117775431709176"
  },
  "cylinder": {
    "model": "130948264514897",
    "mesh": "104060676018658"
  },
  "box": {
    "model": "86951482838483",
    "mesh": "95185938457934"
  },
  "plane": {
    "model": "122646021556659",
    "mesh": "120061004537637"
  }
};
