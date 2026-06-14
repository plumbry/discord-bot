const MEMBER_LIST_PAGE_DELAY_MS = 500;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function forEachGuildMemberPage(guild, fn) {
  let after;

  while (true) {
    const batch = await guild.members.list({
      limit: 1000,
      after,
      cache: true
    });

    if (batch.size === 0) {
      break;
    }

    await fn(batch);

    after = batch.lastKey();

    if (batch.size < 1000) {
      break;
    }

    await delay(MEMBER_LIST_PAGE_DELAY_MS);
  }
}

module.exports = {
  forEachGuildMemberPage
};
