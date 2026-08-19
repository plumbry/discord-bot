const { PermissionFlagsBits } = require("discord.js");

function userIsStaff(member) {
  if (!member) {
    return false;
  }

  if (
    member.permissions?.has(PermissionFlagsBits.Administrator) ||
    member.permissions?.has(PermissionFlagsBits.ManageRoles)
  ) {
    return true;
  }

  const roleIds = [process.env.STAFF_ROLE_ID, process.env.ADMIN_ROLE_ID]
    .filter(Boolean)
    .flatMap(value => String(value).split(","))
    .map(value => value.trim())
    .filter(Boolean);

  return roleIds.some(roleId => member.roles?.cache?.has(roleId));
}

module.exports = {
  userIsStaff
};
