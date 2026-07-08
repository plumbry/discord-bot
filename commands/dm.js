const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

const crypto = require("crypto");
const { getSheets } = require("../lib/sheets");

/* ===================== CONSTANTS ===================== */

const MOD_CHANNEL_ID = "1471082166535454780";
const SHEET_NAME = "Scheduled DMs";
const SHEET_RANGE = SHEET_NAME + "!A:AZ";
const HEADER_RANGE = SHEET_NAME + "!A1:AZ1";
const DATA_RANGE = SHEET_NAME + "!A2:AZ";
const REEVAL_SOURCE = "reeval_send_dm";

const ROLE_DM_DELAY_MS = 1200;
const USER_DM_DELAY_MS = 750;

let schedulerRunning = false;

/* ===================== ENV ===================== */

if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64) {
  throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON_BASE64");
}

if (!process.env.MAIN_SHEET_ID) {
  throw new Error("Missing MAIN_SHEET_ID");
}

/* ===================== HELPERS ===================== */

const nowISO = () => new Date().toISOString();
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const LEGACY_HEADERS = [
  "jobId",
  "targetType",
  "targetId",
  "message",
  "sendAt",
  "status",
  "moderatorId",
  "createdAt",
  "sentAt",
  "failedUserIds",
  "error",
  "cancelledBy",
  "cancelledAt",
  "previewMessageId",
  "guildId"
];

const REEVAL_HEADERS = [
  "dmId",
  "userId",
  "username",
  "source",
  "sourceChannelId",
  "sourceMessageId",
  "subject",
  "dmMessage",
  "status",
  "deadline",
  "createdBy",
  "createdAt",
  "sentAt",
  "replyEnabled",
  "replyThreadId",
  "staffMessageId",
  "lastUserReply",
  "lastStaffReply",
  "resolvedBy",
  "resolvedAt",
  "conversationHistoryJson"
];

function parseUTCDateTime(date, time) {
  if (!date || !time) return "";

  // 🚨 SAFELY BUILD STRING (no template literals)
  const iso = date + "T" + time + ":00.000Z";

  const parsed = new Date(iso);

  if (isNaN(parsed.getTime())) {
    throw new Error("Invalid date/time");
  }

  return parsed.toISOString();
}

async function updateRow(rowNumber, row) {
  await getSheets().spreadsheets.values.update({
    spreadsheetId: process.env.MAIN_SHEET_ID,
    range: SHEET_NAME + "!A" + rowNumber + ":Z" + rowNumber,
    valueInputOption: "RAW",
    requestBody: { values: [row] }
  });
}

function columnLetter(index) {
  let letter = "";
  let value = index + 1;

  while (value > 0) {
    const remainder = (value - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    value = Math.floor((value - 1) / 26);
  }

  return letter;
}

function buildHeaderIndex(headers) {
  return headers.reduce((acc, header, index) => {
    if (header) acc[header] = index;
    return acc;
  }, {});
}

function padRow(row, length) {
  const padded = [...(row || [])];

  while (padded.length < length) {
    padded.push("");
  }

  return padded.slice(0, length);
}

async function ensureScheduledDmColumns() {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.MAIN_SHEET_ID,
    range: HEADER_RANGE
  });

  let headers = res.data.values?.[0] || [];

  if (!headers.length || !headers[0]) {
    headers = [...LEGACY_HEADERS];
  }

  for (let i = 0; i < LEGACY_HEADERS.length; i++) {
    if (!headers[i]) {
      headers[i] = LEGACY_HEADERS[i];
    }
  }

  for (const header of REEVAL_HEADERS) {
    if (!headers.includes(header)) {
      headers.push(header);
    }
  }

  const endColumn = columnLetter(headers.length - 1);

  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.MAIN_SHEET_ID,
    range: `${SHEET_NAME}!A1:${endColumn}1`,
    valueInputOption: "RAW",
    requestBody: { values: [headers] }
  });

  return { headers, index: buildHeaderIndex(headers) };
}

async function getScheduledDmRows() {
  const { headers, index } = await ensureScheduledDmColumns();
  const res = await getSheets().spreadsheets.values.get({
    spreadsheetId: process.env.MAIN_SHEET_ID,
    range: DATA_RANGE
  });

  return {
    headers,
    index,
    rows: res.data.values || []
  };
}

async function updateScheduledDmRecord(rowNumber, row, columnCount) {
  const endColumn = columnLetter(columnCount - 1);

  await getSheets().spreadsheets.values.update({
    spreadsheetId: process.env.MAIN_SHEET_ID,
    range: `${SHEET_NAME}!A${rowNumber}:${endColumn}${rowNumber}`,
    valueInputOption: "RAW",
    requestBody: { values: [padRow(row, columnCount)] }
  });
}

function readCell(row, index, header) {
  const position = index[header];
  return position === undefined ? "" : row[position] || "";
}

function writeCell(row, index, header, value) {
  const position = index[header];

  if (position !== undefined) {
    row[position] = value ?? "";
  }
}

function rowToReevalRecord(row, index, rowNumber) {
  const legacyDmId = row[0] || "";
  const legacyUserId = row[2] || "";

  return {
    rowNumber,
    dmId: readCell(row, index, "dmId") || legacyDmId,
    userId: readCell(row, index, "userId") || legacyUserId,
    username: readCell(row, index, "username"),
    source: readCell(row, index, "source"),
    sourceChannelId: readCell(row, index, "sourceChannelId"),
    sourceMessageId: readCell(row, index, "sourceMessageId"),
    subject: readCell(row, index, "subject"),
    dmMessage: readCell(row, index, "dmMessage") || row[3] || "",
    deadline: readCell(row, index, "deadline"),
    status: readCell(row, index, "status") || row[5] || "",
    createdBy: readCell(row, index, "createdBy") || row[6] || "",
    createdAt: readCell(row, index, "createdAt") || row[7] || "",
    sentAt: readCell(row, index, "sentAt") || row[8] || "",
    replyEnabled: readCell(row, index, "replyEnabled"),
    replyThreadId: readCell(row, index, "replyThreadId"),
    staffMessageId: readCell(row, index, "staffMessageId"),
    lastUserReply: readCell(row, index, "lastUserReply"),
    lastStaffReply: readCell(row, index, "lastStaffReply"),
    resolvedBy: readCell(row, index, "resolvedBy"),
    resolvedAt: readCell(row, index, "resolvedAt"),
    conversationHistoryJson: readCell(row, index, "conversationHistoryJson")
  };
}

async function findReevalRecord(dmId) {
  const { headers, index, rows } = await getScheduledDmRows();
  const dmIdIndex = index.dmId;

  for (let i = 0; i < rows.length; i++) {
    const row = padRow(rows[i], headers.length);
    const record = rowToReevalRecord(row, index, i + 2);

    if (
      record.dmId === dmId &&
      record.source === REEVAL_SOURCE &&
      String(record.replyEnabled).toUpperCase() === "TRUE"
    ) {
      return {
        headers,
        index,
        row,
        rowNumber: i + 2,
        record
      };
    }

    if (dmIdIndex !== undefined && row[dmIdIndex] === dmId) {
      return null;
    }
  }

  return null;
}

function setReevalCells(row, index, record) {
  writeCell(row, index, "dmId", record.dmId);
  writeCell(row, index, "userId", record.userId);
  writeCell(row, index, "username", record.username);
  writeCell(row, index, "source", record.source);
  writeCell(row, index, "sourceChannelId", record.sourceChannelId);
  writeCell(row, index, "sourceMessageId", record.sourceMessageId);
  writeCell(row, index, "subject", record.subject);
  writeCell(row, index, "dmMessage", record.dmMessage);
  writeCell(row, index, "status", record.status);
  writeCell(row, index, "deadline", record.deadline);
  writeCell(row, index, "createdBy", record.createdBy);
  writeCell(row, index, "createdAt", record.createdAt);
  writeCell(row, index, "sentAt", record.sentAt);
  writeCell(row, index, "replyEnabled", record.replyEnabled);
  writeCell(row, index, "replyThreadId", record.replyThreadId);
  writeCell(row, index, "staffMessageId", record.staffMessageId);
  writeCell(row, index, "lastUserReply", record.lastUserReply);
  writeCell(row, index, "lastStaffReply", record.lastStaffReply);
  writeCell(row, index, "resolvedBy", record.resolvedBy);
  writeCell(row, index, "resolvedAt", record.resolvedAt);
  writeCell(row, index, "conversationHistoryJson", record.conversationHistoryJson);
}

async function updateReevalRecord(found, updates) {
  const record = {
    ...found.record,
    ...updates
  };
  const row = padRow(found.row, found.headers.length);

  row[5] = record.status || "";
  row[7] = record.createdAt || "";
  row[8] = record.sentAt || "";
  setReevalCells(row, found.index, record);

  await updateScheduledDmRecord(found.rowNumber, row, found.headers.length);

  return {
    ...found,
    row,
    record
  };
}

function parseHistory(value) {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function appendHistory(record, entry) {
  const history = parseHistory(record.conversationHistoryJson);
  history.push({
    at: nowISO(),
    ...entry
  });

  return JSON.stringify(history.slice(-50));
}

function truncate(value, max = 1024) {
  const text = String(value || "").trim();

  if (!text) return "None";
  if (text.length <= max) return text;

  return text.slice(0, max - 3) + "...";
}

function parseTargetUserId(value) {
  const text = String(value || "").trim();
  const mention = text.match(/^<@!?(\d+)>$/);

  if (mention) return mention[1];
  if (/^\d{15,25}$/.test(text)) return text;

  return "";
}

function configuredRoleIds() {
  return [
    process.env.STAFF_ROLE_ID,
    process.env.ADMIN_ROLE_ID
  ]
    .filter(Boolean)
    .flatMap(value => String(value).split(","))
    .map(value => value.trim())
    .filter(Boolean);
}

function userIsStaff(member) {
  if (member?.permissions?.has(PermissionFlagsBits.Administrator)) {
    return true;
  }

  const roleIds = configuredRoleIds();

  return roleIds.some(roleId => member?.roles?.cache?.has(roleId));
}

function buildReevalSendModal() {
  return new ModalBuilder()
    .setCustomId("reeval_dm_send_modal")
    .setTitle("Send Re-Eval DM")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("target")
          .setLabel("Target member/user mention or ID")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("subject")
          .setLabel("Subject")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(200)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("message")
          .setLabel("DM message")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(4000)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("deadline")
          .setLabel("Optional due date/deadline")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(100)
      )
    );
}

function buildReplyModal(customId, title) {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("reply")
          .setLabel("Response")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(4000)
      )
    );
}

function buildMemberDmPayload(record, message) {
  const fields = [
    { name: "Subject", value: truncate(record.subject) },
    { name: "Message", value: truncate(message, 4000) }
  ];

  if (record.deadline) {
    fields.push({ name: "Deadline", value: truncate(record.deadline) });
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .addFields(fields);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`reeval_dm_user_reply:${record.dmId}`)
      .setLabel("Reply")
      .setStyle(ButtonStyle.Primary)
  );

  return {
    embeds: [embed],
    components: [row]
  };
}

function buildStaffSummaryPayload(record, disabled = false) {
  const embed = new EmbedBuilder()
    .setTitle("Re-Eval DM Conversation")
    .setColor(record.status === "resolved" ? 0x57f287 : 0xfee75c)
    .addFields(
      { name: "User", value: `<@${record.userId}>`, inline: true },
      { name: "Username", value: truncate(record.username, 256), inline: true },
      { name: "Discord ID", value: record.userId || "Unknown", inline: true },
      { name: "Subject", value: truncate(record.subject) },
      { name: "Original DM Message", value: truncate(record.dmMessage) },
      { name: "Latest User Reply", value: truncate(record.lastUserReply) },
      { name: "Status", value: record.status || "open", inline: true },
      {
        name: "Created By",
        value: record.createdBy ? `<@${record.createdBy}>` : "Unknown",
        inline: true
      },
      { name: "Created At", value: record.createdAt || "Unknown", inline: true }
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`reeval_dm_staff_reply:${record.dmId}`)
      .setLabel("Reply")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled || record.status === "resolved"),
    new ButtonBuilder()
      .setCustomId(`reeval_dm_resolve:${record.dmId}`)
      .setLabel("Mark Resolved")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled || record.status === "resolved")
  );

  return {
    content: `<@${record.userId}> re-eval DM conversation`,
    embeds: [embed],
    components: [row]
  };
}

function buildReevalPanelPayload() {
  const embed = new EmbedBuilder()
    .setTitle("Re-Eval DMs")
    .setDescription(
      "Staff can use this panel to send replyable re-eval DMs. " +
      "Member DMs only include a Reply button."
    )
    .setColor(0x5865f2);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("reeval_dm_send")
      .setLabel("Send DM")
      .setStyle(ButtonStyle.Primary)
  );

  return {
    embeds: [embed],
    components: [row]
  };
}

async function resolveStaffChannel(client, record) {
  const channelId =
    record.sourceChannelId ||
    process.env.REEVAL_DM_ADMIN_CHANNEL_ID ||
    MOD_CHANNEL_ID;

  return client.channels.fetch(channelId).catch(() => null);
}

async function sendOrUpdateStaffSummary(client, found) {
  const record = found.record;
  const channel = await resolveStaffChannel(client, record);

  if (!channel?.isTextBased?.()) {
    throw new Error("Staff channel is not available.");
  }

  const payload = buildStaffSummaryPayload(record);
  let message = null;

  if (record.sourceMessageId) {
    message = await channel.messages
      .fetch(record.sourceMessageId)
      .catch(() => null);
  }

  if (message) {
    await message.edit(payload);
    return { message, threadId: record.replyThreadId || "" };
  }

  message = await channel.send(payload);
  let threadId = "";

  if (typeof message.startThread === "function") {
    const thread = await message.startThread({
      name: `re-eval-dm-${record.username || record.userId}`.slice(0, 90),
      autoArchiveDuration: 10080,
      reason: "Re-eval replyable DM conversation"
    }).catch(err => {
      console.error("[REEVAL DM] Could not create thread:", err?.message || err);
      return null;
    });

    threadId = thread?.id || "";
  }

  return { message, threadId };
}

async function postConversationThreadLine(client, record, content) {
  if (!record.replyThreadId) return;

  const thread = await client.channels
    .fetch(record.replyThreadId)
    .catch(() => null);

  if (thread?.isTextBased?.()) {
    await thread.send(content).catch(err => {
      console.error("[REEVAL DM] Could not post to thread:", err?.message || err);
    });
  }
}

async function appendReevalRow(record) {
  const { headers, index } = await ensureScheduledDmColumns();
  const row = padRow([], headers.length);

  row[0] = record.dmId;
  row[1] = "user";
  row[2] = record.userId;
  row[3] = record.dmMessage;
  row[4] = "";
  row[5] = record.status;
  row[6] = record.createdBy;
  row[7] = record.createdAt;
  row[8] = record.sentAt || "";
  row[14] = record.guildId || "";
  setReevalCells(row, index, record);

  await getSheets().spreadsheets.values.append({
    spreadsheetId: process.env.MAIN_SHEET_ID,
    range: SHEET_RANGE,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] }
  });
}

async function handleReevalSendModal(interaction) {
  if (!userIsStaff(interaction.member)) {
    await interaction.reply({
      content: "You do not have permission to send re-eval DMs.",
      ephemeral: true
    });
    return true;
  }

  await interaction.deferReply({ ephemeral: true });

  const targetInput = interaction.fields.getTextInputValue("target");
  const userId = parseTargetUserId(targetInput);
  const subject = interaction.fields.getTextInputValue("subject").trim();
  const dmMessage = interaction.fields.getTextInputValue("message").trim();
  const deadline = interaction.fields.getTextInputValue("deadline").trim();

  if (!userId) {
    await interaction.editReply("Enter a valid user mention or Discord ID.");
    return true;
  }

  if (!subject || !dmMessage) {
    await interaction.editReply("Subject and DM message are required.");
    return true;
  }

  const user = await interaction.client.users.fetch(userId).catch(() => null);

  if (!user) {
    await interaction.editReply("That user could not be found.");
    return true;
  }

  const createdAt = nowISO();
  const record = {
    dmId: crypto.randomUUID(),
    userId,
    username: user.tag || user.username || userId,
    source: REEVAL_SOURCE,
    sourceChannelId: interaction.channelId || process.env.REEVAL_DM_ADMIN_CHANNEL_ID || MOD_CHANNEL_ID,
    sourceMessageId: "",
    subject,
    dmMessage,
    deadline,
    status: "open",
    createdBy: interaction.user.id,
    createdAt,
    sentAt: "",
    replyEnabled: "TRUE",
    replyThreadId: "",
    staffMessageId: "",
    lastUserReply: "",
    lastStaffReply: "",
    resolvedBy: "",
    resolvedAt: "",
    conversationHistoryJson: JSON.stringify([
      {
        at: createdAt,
        authorType: "staff",
        authorId: interaction.user.id,
        message: dmMessage,
        event: "initial_dm"
      }
    ]),
    guildId: interaction.guildId || ""
  };

  try {
    await appendReevalRow(record);
  } catch (err) {
    console.error("[REEVAL DM] Sheet append failed:", err);
    await interaction.editReply("Google Sheet update failed. DM was not sent.");
    return true;
  }

  let found = await findReevalRecord(record.dmId);

  try {
    await user.send(buildMemberDmPayload(record, dmMessage));
  } catch (err) {
    console.error("[REEVAL DM] Could not send DM:", err?.message || err);

    if (found) {
      await updateReevalRecord(found, {
        status: "failed"
      }).catch(updateErr => {
        console.error("[REEVAL DM] Could not mark failed:", updateErr);
      });
    }

    await interaction.editReply("Could not send the DM. The user's DMs may be closed.");
    return true;
  }

  if (found) {
    found = await updateReevalRecord(found, { sentAt: nowISO() });
  }

  try {
    const summary = await sendOrUpdateStaffSummary(interaction.client, {
      ...found,
      record: found?.record || record
    });

    if (found) {
      await updateReevalRecord(found, {
        sourceMessageId: summary.message.id,
        staffMessageId: summary.message.id,
        replyThreadId: summary.threadId || found.record.replyThreadId || ""
      });
    }
  } catch (err) {
    console.error("[REEVAL DM] Staff logging failed:", err);
  }

  await interaction.editReply(`DM sent to ${user}.`);
  return true;
}

async function handleUserReplyModal(interaction, dmId) {
  await interaction.deferReply({ ephemeral: true });

  const found = await findReevalRecord(dmId);

  if (!found) {
    await interaction.editReply("This conversation could not be found or is no longer active.");
    return true;
  }

  if (found.record.userId !== interaction.user.id) {
    await interaction.editReply("This conversation could not be found or is no longer active.");
    return true;
  }

  if (found.record.status === "resolved") {
    await interaction.editReply("This conversation has been closed.");
    return true;
  }

  const reply = interaction.fields.getTextInputValue("reply").trim();

  if (!reply) {
    await interaction.editReply("Reply cannot be empty.");
    return true;
  }

  let updated;

  try {
    updated = await updateReevalRecord(found, {
      lastUserReply: reply,
      conversationHistoryJson: appendHistory(found.record, {
        authorType: "user",
        authorId: interaction.user.id,
        message: reply
      })
    });
  } catch (err) {
    console.error("[REEVAL DM] Could not save user reply:", err);
    await interaction.editReply("Could not save your reply. Please try again later.");
    return true;
  }

  try {
    const summary = await sendOrUpdateStaffSummary(interaction.client, updated);
    updated = await updateReevalRecord(updated, {
      sourceMessageId: summary.message.id,
      staffMessageId: summary.message.id,
      replyThreadId: summary.threadId || updated.record.replyThreadId || ""
    });

    await postConversationThreadLine(
      interaction.client,
      updated.record,
      `**User reply from <@${interaction.user.id}>:**\n${reply}`
    );
  } catch (err) {
    console.error("[REEVAL DM] Staff notification failed:", err);
  }

  await interaction.editReply("Your reply has been sent to staff.");
  return true;
}

async function handleStaffReplyModal(interaction, dmId) {
  if (!userIsStaff(interaction.member)) {
    await interaction.reply({
      content: "You do not have permission to reply to this conversation.",
      ephemeral: true
    });
    return true;
  }

  await interaction.deferReply({ ephemeral: true });

  const found = await findReevalRecord(dmId);

  if (!found) {
    await interaction.editReply("This conversation could not be found or is no longer active.");
    return true;
  }

  if (found.record.status === "resolved") {
    await interaction.editReply("This conversation has been closed.");
    return true;
  }

  const reply = interaction.fields.getTextInputValue("reply").trim();
  const user = await interaction.client.users.fetch(found.record.userId).catch(() => null);

  if (!reply) {
    await interaction.editReply("Reply cannot be empty.");
    return true;
  }

  if (!user) {
    await interaction.editReply("The target user could not be found.");
    return true;
  }

  try {
    await user.send(buildMemberDmPayload(found.record, reply));
  } catch (err) {
    console.error("[REEVAL DM] Could not send staff reply:", err?.message || err);
    await interaction.editReply("Could not send the DM. The user's DMs may be closed.");
    return true;
  }

  let updated;

  try {
    updated = await updateReevalRecord(found, {
      lastStaffReply: reply,
      conversationHistoryJson: appendHistory(found.record, {
        authorType: "staff",
        authorId: interaction.user.id,
        message: reply
      })
    });
  } catch (err) {
    console.error("[REEVAL DM] Could not save staff reply:", err);
    await interaction.editReply("Reply sent, but Google Sheet update failed.");
    return true;
  }

  try {
    await sendOrUpdateStaffSummary(interaction.client, updated);
    await postConversationThreadLine(
      interaction.client,
      updated.record,
      `**Staff reply from <@${interaction.user.id}>:**\n${reply}`
    );
  } catch (err) {
    console.error("[REEVAL DM] Staff summary update failed:", err);
  }

  await interaction.editReply("Reply sent.");
  return true;
}

async function handleResolve(interaction, dmId) {
  if (!userIsStaff(interaction.member)) {
    await interaction.reply({
      content: "You do not have permission to resolve this conversation.",
      ephemeral: true
    });
    return true;
  }

  await interaction.deferReply({ ephemeral: true });

  const found = await findReevalRecord(dmId);

  if (!found) {
    await interaction.editReply("This conversation could not be found or is no longer active.");
    return true;
  }

  const resolvedAt = nowISO();
  const updated = await updateReevalRecord(found, {
    status: "resolved",
    resolvedBy: interaction.user.id,
    resolvedAt,
    conversationHistoryJson: appendHistory(found.record, {
      authorType: "staff",
      authorId: interaction.user.id,
      event: "resolved"
    })
  });

  try {
    const channel = await resolveStaffChannel(interaction.client, updated.record);
    const message = updated.record.sourceMessageId && channel?.isTextBased?.()
      ? await channel.messages.fetch(updated.record.sourceMessageId).catch(() => null)
      : null;

    if (message) {
      await message.edit(buildStaffSummaryPayload(updated.record, true));
    }

    await postConversationThreadLine(
      interaction.client,
      updated.record,
      `Conversation resolved by <@${interaction.user.id}>.`
    );
  } catch (err) {
    console.error("[REEVAL DM] Resolve staff message update failed:", err);
  }

  await interaction.editReply("Conversation marked resolved.");
  return true;
}

/* ===================== SLASH COMMAND ===================== */

const dmCommand = new SlashCommandBuilder()
  .setName("dm")
  .setDescription("Send or schedule DMs")

  .addSubcommand(sub =>
    sub
      .setName("preview-user")
      .setDescription("Preview a DM to a user")
      .addUserOption(o =>
        o.setName("user").setDescription("Target user").setRequired(true)
      )
      .addStringOption(o =>
        o.setName("message").setDescription("Message content").setRequired(true)
      )
      .addStringOption(o =>
        o.setName("date").setDescription("Send date (UTC)")
      )
      .addStringOption(o =>
        o.setName("time").setDescription("Send time (UTC)")
      )
  )

  .addSubcommand(sub =>
    sub
      .setName("preview-role")
      .setDescription("Preview a DM to a role")
      .addRoleOption(o =>
        o.setName("role").setDescription("Target role").setRequired(true)
      )
      .addStringOption(o =>
        o.setName("message").setDescription("Message content").setRequired(true)
      )
      .addStringOption(o =>
        o.setName("date").setDescription("Send date (UTC)")
      )
      .addStringOption(o =>
        o.setName("time").setDescription("Send time (UTC)")
      )
  )

  .addSubcommand(sub =>
    sub
      .setName("setup-reeval-panel")
      .setDescription("Post the staff-only re-eval DM panel")
      .addChannelOption(o =>
        o
          .setName("channel")
          .setDescription("Channel to post the panel in")
          .addChannelTypes(ChannelType.GuildText)
      )
  );

/* ===================== COMMAND ===================== */

async function handleDM(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const sub = interaction.options.getSubcommand();

  if (sub === "setup-reeval-panel") {
    if (!userIsStaff(interaction.member)) {
      return interaction.editReply(
        "You do not have permission to set up the re-eval DM panel."
      );
    }

    const channel = interaction.options.getChannel("channel") || interaction.channel;

    if (!channel?.isTextBased?.()) {
      return interaction.editReply("Choose a text channel for the panel.");
    }

    await channel.send(buildReevalPanelPayload());

    return interaction.editReply(`Re-eval DM panel posted in ${channel}.`);
  }

  const message = interaction.options.getString("message");

  const date = interaction.options.getString("date");
  const time = interaction.options.getString("time");

  let sendAt = "";

  try {
    sendAt = parseUTCDateTime(date, time);
  } catch {
    return interaction.editReply("❌ Invalid date/time (UTC).");
  }

  const jobId = crypto.randomUUID();
  const isUser = sub === "preview-user";

  const targetId = isUser
    ? interaction.options.getUser("user").id
    : interaction.options.getRole("role").id;

  const embed = new EmbedBuilder()
    .setTitle("DM PREVIEW")
    .setColor(0x5865f2)
    .addFields(
      { name: "Moderator", value: "<@" + interaction.user.id + ">" },
      {
        name: "Target",
        value: isUser
          ? "<@" + targetId + ">"
          : "<@&" + targetId + ">"
      },
      { name: "Message", value: message },
      {
        name: sendAt ? "Scheduled For" : "Send",
        value: sendAt || "Immediately"
      }
    );

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("dm_confirm:" + jobId)
      .setLabel("Confirm")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("dm_cancel:" + jobId)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger)
  );

  const channel = await interaction.client.channels.fetch(MOD_CHANNEL_ID);

  const previewMessage = await channel.send({
    embeds: [embed],
    components: [buttons]
  });

  await getSheets().spreadsheets.values.append({
    spreadsheetId: process.env.MAIN_SHEET_ID,
    range: SHEET_NAME + "!A:Z",
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        jobId,
        isUser ? "user" : "role",
        targetId,
        message,
        sendAt,
        sendAt ? "scheduled" : "pending",
        interaction.user.id,
        nowISO(),
        "",
        "",
        "",
        "",
        "",
        previewMessage.id,
        interaction.guildId
      ]]
    }
  });

  await interaction.editReply("✅ Preview posted.");
}

/* ===================== BUTTON ===================== */

async function handleDMButton(interaction) {
  const parts = interaction.customId.split(":");
  const action = parts[0];
  const jobId = parts[1];

  await interaction.deferUpdate();

  const res = await getSheets().spreadsheets.values.get({
    spreadsheetId: process.env.MAIN_SHEET_ID,
    range: SHEET_NAME + "!A2:Z"
  });

  const rows = res.data.values || [];
  const index = rows.findIndex(r => r[0] === jobId);

  if (index === -1) return;

  const rowNumber = index + 2;
  const row = rows[index];

  if (action === "dm_cancel") {
    row[5] = "cancelled";
    row[4] = "";
    row[11] = interaction.user.id;
    row[12] = nowISO();

    await updateRow(rowNumber, row);
    await interaction.message.edit({ components: [] });
    return;
  }

  if (action === "dm_confirm") {
    if (!row[4]) {
      row[4] = nowISO();
      row[5] = "scheduled";
      await updateRow(rowNumber, row);
    }

    await interaction.message.edit({ components: [] });
  }
}

async function handleButton(interaction) {
  if (
    interaction.customId.startsWith("dm_confirm:") ||
    interaction.customId.startsWith("dm_cancel:")
  ) {
    await handleDMButton(interaction);
    return true;
  }

  if (interaction.customId === "reeval_dm_send") {
    if (!userIsStaff(interaction.member)) {
      await interaction.reply({
        content: "You do not have permission to send re-eval DMs.",
        ephemeral: true
      });
      return true;
    }

    await interaction.showModal(buildReevalSendModal());
    return true;
  }

  if (interaction.customId.startsWith("reeval_dm_user_reply:")) {
    const dmId = interaction.customId.split(":")[1];
    const found = await findReevalRecord(dmId);

    if (!found) {
      await interaction.reply({
        content: "This conversation could not be found or is no longer active.",
        ephemeral: true
      });
      return true;
    }

    if (found.record.userId !== interaction.user.id) {
      await interaction.reply({
        content: "This conversation could not be found or is no longer active.",
        ephemeral: true
      });
      return true;
    }

    if (found.record.status === "resolved") {
      await interaction.reply({
        content: "This conversation has been closed.",
        ephemeral: true
      });
      return true;
    }

    await interaction.showModal(
      buildReplyModal(`reeval_dm_user_reply_modal:${dmId}`, "Reply to Staff")
    );
    return true;
  }

  if (interaction.customId.startsWith("reeval_dm_staff_reply:")) {
    const dmId = interaction.customId.split(":")[1];

    if (!userIsStaff(interaction.member)) {
      await interaction.reply({
        content: "You do not have permission to reply to this conversation.",
        ephemeral: true
      });
      return true;
    }

    const found = await findReevalRecord(dmId);

    if (!found || found.record.status === "resolved") {
      await interaction.reply({
        content: found
          ? "This conversation has been closed."
          : "This conversation could not be found or is no longer active.",
        ephemeral: true
      });
      return true;
    }

    await interaction.showModal(
      buildReplyModal(`reeval_dm_staff_reply_modal:${dmId}`, "Reply to Member")
    );
    return true;
  }

  if (interaction.customId.startsWith("reeval_dm_resolve:")) {
    const dmId = interaction.customId.split(":")[1];
    await handleResolve(interaction, dmId);
    return true;
  }

  return false;
}

async function handleModalSubmit(interaction) {
  if (interaction.customId === "reeval_dm_send_modal") {
    return handleReevalSendModal(interaction);
  }

  if (interaction.customId.startsWith("reeval_dm_user_reply_modal:")) {
    const dmId = interaction.customId.split(":")[1];
    return handleUserReplyModal(interaction, dmId);
  }

  if (interaction.customId.startsWith("reeval_dm_staff_reply_modal:")) {
    const dmId = interaction.customId.split(":")[1];
    return handleStaffReplyModal(interaction, dmId);
  }

  return false;
}

/* ===================== SCHEDULER ===================== */

function startDMScheduler(client) {
  setInterval(async () => {
    if (schedulerRunning) return;

    schedulerRunning = true;

    try {
      const res = await getSheets().spreadsheets.values.get({
        spreadsheetId: process.env.MAIN_SHEET_ID,
        range: SHEET_NAME + "!A2:Z"
      });

      const rows = res.data.values || [];
      const now = new Date();

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNumber = i + 2;

        if (row[5] !== "scheduled") continue;
        if (new Date(row[4]) > now) continue;

        let total = 0;
        let sent = 0;
        let failed = [];

        try {
          if (row[1] === "user") {
            total = 1;

            const user = await client.users.fetch(row[2]);
            await user.send(row[3]);

            sent = 1;
            await delay(USER_DM_DELAY_MS);
          } else {
            const guild = await client.guilds.fetch(row[14]);
            const targetRole =
              await guild.roles.fetch(row[2]).catch(() => null);

            let memberList = targetRole
              ? [...targetRole.members.values()]
              : [];

            if (memberList.length === 0) {

              console.log(
                `[DM] Fetching all members for role ${row[2]} (not in cache)`
              );

              await guild.members.fetch();

              memberList = guild.members.cache.filter(m =>
                m.roles.cache.has(row[2])
              ).map(m => m);

            }

            if (memberList.length > 200) {

              console.warn(
                `[DM] Large role blast: ${memberList.length} recipients`
              );

            }

            total = memberList.length;

            for (const member of memberList) {
              try {
                await member.send(row[3]);
                sent++;
              } catch {
                failed.push(member.id);
              }

              await delay(ROLE_DM_DELAY_MS);
            }
          }

          row[5] =
            sent === 0 ? "failed" :
            sent < total ? "partial" :
            "sent";

          row[8] = nowISO();

        } catch (err) {
          row[5] = "failed";
          row[10] = err.message;
        }

        row[9] = failed.join(",");
        await updateRow(rowNumber, row);
      }

    } finally {
      schedulerRunning = false;
    }

  }, 30000);
}

/* ===================== EXPORTS ===================== */

module.exports = {
  data: dmCommand,
  execute: handleDM,
  dmCommand,
  handleDM,
  handleButton,
  handleModalSubmit,
  handleDMButton,
  startDMScheduler
};