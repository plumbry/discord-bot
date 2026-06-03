const { TIER_ROLE_IDS } = require("./tierRestrictions");

const BOY_ROLE_ID =
  process.env.BOY_ROLE_ID || "1467517668209721405";

const GIRL_ROLE_ID =
  process.env.GIRL_ROLE_ID || "1371652325629755472";

function genderFromRoleName(roleName) {
  const name = roleName.trim().toLowerCase();

  if (
    name === "boy" ||
    name === "boy role" ||
    name.startsWith("boy ")
  ) {
    return "Boy";
  }

  if (
    name === "girl" ||
    name === "girl role" ||
    name.startsWith("girl ")
  ) {
    return "Girl";
  }

  return null;
}

function getMemberTier(member) {
  for (const [letter, roleId] of Object.entries(TIER_ROLE_IDS)) {
    if (member.roles.cache.has(roleId)) {
      return letter;
    }
  }

  return null;
}

function getMemberGender(member) {
  if (member.roles.cache.has(BOY_ROLE_ID)) {
    return "Boy";
  }

  if (member.roles.cache.has(GIRL_ROLE_ID)) {
    return "Girl";
  }

  for (const role of member.roles.cache.values()) {
    const gender = genderFromRoleName(role.name);

    if (gender) {
      return gender;
    }
  }

  return null;
}

function memberHasGirlRole(member) {
  if (!member) {
    return false;
  }

  if (member.roles.cache.has(GIRL_ROLE_ID)) {
    return true;
  }

  for (const role of member.roles.cache.values()) {
    if (genderFromRoleName(role.name) === "Girl") {
      return true;
    }
  }

  return false;
}

module.exports = {
  GIRL_ROLE_ID,
  BOY_ROLE_ID,
  genderFromRoleName,
  getMemberTier,
  getMemberGender,
  memberHasGirlRole
};
