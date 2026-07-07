const { 
  Client, 
  GatewayIntentBits, 
  ActivityType, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  StringSelectMenuBuilder, 
  StringSelectMenuOptionBuilder, 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle, 
  Partials,
  AttachmentBuilder
} = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DIR = __dirname;
const DB_FILE = path.join(DIR, 'failbot.db');

// ===== БАЗА ДАННЫХ =====
const db = new sqlite3.Database(DB_FILE);

function initDb() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)", (err) => { if (err) reject(err); });
      db.run("CREATE TABLE IF NOT EXISTS message_buttons (message_id TEXT PRIMARY KEY, guild_id INTEGER, channel_id INTEGER, buttons TEXT)", (err) => {
        if (err) reject(err);
        else {
          // Начальные значения
          const defaults = {
            "log_channel_id": "",
            "everyone_role_id": "",
            "owner_id": "",
            "allowed_role_ids": "[]",
            "allowed_guilds": "[]",
            "boost_channel_id": "",
            "welcome_channel_id": "",
          };
          const stmt = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
          for (const [k, v] of Object.entries(defaults)) {
            stmt.run(k, v);
          }
          stmt.finalize((err2) => {
            if (err2) reject(err2);
            else resolve();
          });
        }
      });
    });
  });
}

function getSetting(key, defaultValue = "") {
  return new Promise((resolve) => {
    db.get("SELECT value FROM settings WHERE key = ?", [key], (err, row) => {
      if (err || !row) resolve(defaultValue);
      else resolve(row.value);
    });
  });
}

function setSetting(key, value) {
  return new Promise((resolve, reject) => {
    db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, String(value)], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function getAllowedRoles() {
  const v = await getSetting("allowed_role_ids", "[]");
  try { return JSON.parse(v); } catch { return []; }
}

async function addAllowedRole(rid) {
  const roles = await getAllowedRoles();
  if (!roles.includes(rid)) {
    roles.push(rid);
    await setSetting("allowed_role_ids", JSON.stringify(roles));
  }
}

async function getAllowedGuilds() {
  const v = await getSetting("allowed_guilds", "[]");
  try { return JSON.parse(v); } catch { return []; }
}

async function addAllowedGuild(gid) {
  const guilds = await getAllowedGuilds();
  if (!guilds.includes(gid)) {
    guilds.push(gid);
    await setSetting("allowed_guilds", JSON.stringify(guilds));
  }
}

function saveButtons(msgId, guildId, channelId, buttonsList) {
  return new Promise((resolve, reject) => {
    db.run("INSERT OR REPLACE INTO message_buttons (message_id, guild_id, channel_id, buttons) VALUES (?, ?, ?, ?)",
      [String(msgId), Number(guildId), Number(channelId), JSON.stringify(buttonsList)], (err) => {
        if (err) reject(err);
        else resolve();
      });
  });
}

function getAllButtons() {
  return new Promise((resolve) => {
    db.all("SELECT message_id, guild_id, channel_id, buttons FROM message_buttons", [], (err, rows) => {
      if (err || !rows) {
        resolve({});
        return;
      }
      const result = {};
      for (const row of rows) {
        try {
          result[row.message_id] = {
            guild_id: row.guild_id,
            channel_id: row.channel_id,
            buttons: JSON.parse(row.buttons)
          };
        } catch {}
      }
      resolve(result);
    });
  });
}

function deleteButton(msgId) {
  return new Promise((resolve, reject) => {
    db.run("DELETE FROM message_buttons WHERE message_id = ?", [String(msgId)], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// ===== ДЕШИФРОВАНИЕ ТОКЕНА =====
function decryptToken(encryptedB64, keyB64) {
  try {
    const key = Buffer.from(keyB64, 'base64');
    const enc = Buffer.from(encryptedB64, 'base64');
    const derived = crypto.pbkdf2Sync(key, 'failbot_salt', 100000, 32, 'sha256');
    const dec = Buffer.alloc(enc.length);
    for (let i = 0; i < enc.length; i++) {
      dec[i] = enc[i] ^ derived[i % derived.length];
    }
    return dec.toString('utf8');
  } catch (e) {
    console.log("[-] Ошибка дешифрования токена:", e.message);
    return "";
  }
}

function loadToken() {
  const keyf = path.join(DIR, "bot.key");
  const encf = path.join(DIR, "token.enc");
  if (fs.existsSync(keyf) && fs.existsSync(encf)) {
    try {
      const key_data = fs.readFileSync(keyf, 'utf8').trim();
      const enc_data = fs.readFileSync(encf, 'utf8').trim();
      const t = decryptToken(enc_data, key_data);
      if (t) return t;
    } catch (e) {
      console.log("[-] Ошибка чтения файлов токена:", e.message);
    }
  }
  return process.env.DISCORD_TOKEN || "";
}

// ===== НАСТРОЙКИ И ТЕКСТА =====
const WELCOME_TEXT = `<a:PinkBearSparkle:1522047492420800695> **ДОБРО ПОЖАЛОВАТЬ** <a:PinkBearSparkle:1522047492420800695>

<a:excited_cinnamoroll:1522048092273377500> Привет, **{name}**! Добро пожаловать на сервер **{server}**!

└ Мы очень рады, что ты присоединился к нашему уютному сообществу.
└ Желаем тебе найти здесь новых друзей и отлично провести время!

📌 **Не забудь заглянуть в правила и выбрать себе роли, чтобы полноценно пользоваться сервером.**`;

const BOOST_TEXT = `<a:PinkBearSparkle:1522047492420800695> **СЕРВЕР ЗАБУСТЕН** <a:PinkBearSparkle:1522047492420800695>

<a:PinkHeart:1522047975952744699> **{user}**, огромное спасибо за поддержку нашего сервера **{server}**!

└ Твой буст помогает нам развиваться, добавлять новые функции и становиться ещё уютнее.
└ Мы очень ценим твою помощь и преданность проекту!

<a:flex:1522052547257303070> **Ты просто легенда!**`;

const GIF_NOTIF = "https://i.ibb.co/68Wc6bby/profile.png";       // Картинка ПРОФИЛЬ
const GIF_HOBBY = "https://i.ibb.co/YFp9Y3gW/cozy-roles.png";     // Картинка УЮТНЫЕ РОЛИ
const GIF_GENDER = "https://i.ibb.co/Pv0GswT0/gaming-roles.png";  // Картинка ИГРОВЫЕ РОЛИ

const BUTTON_EMOJI = { id: "1523848897590726668", name: "emoji_40" };

const POL_ROLES = [[1522402019137159329, "Мужской"], [1522402087252529203, "Женский"]];
const UVLECHENIYA_ROLES = [[1522402430212505722, "Дизайнер"], [1522402293188788355, "Читатель"], [1522402184686473398, "Геймер"]];
const NOTIFICATION_ROLES = [[1522402699310792807, "Важные новости"], [1522402763324260464, "Розыгрыши и дропы"], [1522402871293775952, "Игровые сборы"], [1522402942999724222, "Войс-Активность"]];

const COLOR_OPTIONS = {
  "Синий": 0x5865F2, "Красный": 0xED4245, "Зелёный": 0x57F287, "Жёлтый": 0xFEE75C,
  "Оранжевый": 0xE67E22, "Фиолетовый": 0x9B59B6, "Розовый": 0xE91E63, "Бирюзовый": 0x1ABC9C,
  "Серый": 0x95A5A6, "Чёрный": 0x23272A
};

// ===== ИНИЦИАЛИЗАЦИЯ КЛИЕНТА =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildBans,
    GatewayIntentBits.GuildEmojisAndStickers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

const COOLDOWNS = {};
const COOLDOWN_SECONDS = 3600;

function getMoscowTime() {
  const d = new Date();
  const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
  return new Date(utc + (3600000 * 3));
}

function getFormattedMoscowTime() {
  const mt = getMoscowTime();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(mt.getDate())}.${pad(mt.getMonth() + 1)}.${mt.getFullYear()} ${pad(mt.getHours())}:${pad(mt.getMinutes())}`;
}

function isNightTime() {
  const hour = getMoscowTime().getHours();
  return hour >= 23 || hour < 8;
}

function hasAdKeywords(text) {
  if (!text) return false;
  const kw = ["заходите", "переходите", "мы ищем", "мы даем"];
  const t = text.toLowerCase();
  return kw.some(k => t.includes(k));
}

async function getLogChannel(guild) {
  const cid = await getSetting("log_channel_id");
  if (cid && /^\d+$/.test(cid)) {
    return guild.channels.cache.get(cid) || await guild.channels.fetch(cid).catch(() => null);
  }
  return null;
}

async function sendLog(guild, embed) {
  const ch = await getLogChannel(guild);
  if (ch) {
    await ch.send({ embeds: [embed] }).catch(() => null);
  }
}

function makeLogEmbed(title, desc, color, author = null) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(desc)
    .setColor(color)
    .setTimestamp();
  if (author) {
    embed.setFooter({ text: `${author.tag} (${author.id})`, iconURL: author.displayAvatarURL() });
  } else {
    embed.setFooter({ text: `Fail Bot - ${getFormattedMoscowTime()} MSK` });
  }
  return embed;
}

async function checkAccess(interaction) {
  if (interaction.member.permissions.has('Administrator')) return true;
  const oid = await getSetting("owner_id");
  if (oid && interaction.user.id === oid) return true;
  const allowed = await getAllowedRoles();
  if (allowed.length > 0) {
    return interaction.member.roles.cache.some(r => allowed.includes(Number(r.id)));
  }
  return false;
}

// ===== ОБРАБОТКА ДЕЙСТВИЙ КНОПОК ИЗ БД =====
async function handleDatabaseButton(interaction, customId) {
  const parts = customId.split('_');
  if (parts.length < 4) return;
  const msgId = parts[2];
  const btnIdx = parseInt(parts[3]);

  const allBtns = await getAllButtons();
  const config = allBtns[msgId];
  if (!config) return;

  const btnConfig = config.buttons[btnIdx];
  if (!btnConfig) return;

  const roleId = String(btnConfig.role_id);
  const role = interaction.guild.roles.cache.get(roleId) || await interaction.guild.roles.fetch(roleId).catch(() => null);
  if (!role) {
    await interaction.reply({ content: "Эта роль удалена на сервере.", ephemeral: true });
    return;
  }

  const action = btnConfig.action;
  const ck = `${interaction.user.id}_${customId}`;
  const now = Date.now() / 1000;

  if (action === "toggle") {
    const last = COOLDOWNS[ck] || 0;
    const rem = COOLDOWN_SECONDS - (now - last);
    if (rem > 0) {
      const m = Math.floor(rem / 60);
      const s = Math.floor(rem % 60);
      await interaction.reply({ content: `Подождите ${m} мин ${s} сек.`, ephemeral=true });
      return;
    }
    COOLDOWNS[ck] = now;
    if (interaction.member.roles.cache.has(roleId)) {
      await interaction.member.roles.remove(role, "Fail toggle");
      await interaction.reply({ content: `Роль ${role.toString()} снята.`, ephemeral: true });
      await sendLog(interaction.guild, makeLogEmbed("Роль снята", `${interaction.user.toString()}\nРоль: ${role.toString()}`, 0xE67E22, interaction.user));
    } else {
      await interaction.member.roles.add(role, "Fail toggle");
      await interaction.reply({ content: `Роль ${role.toString()} выдана.`, ephemeral: true });
      await sendLog(interaction.guild, makeLogEmbed("Роль выдана", `${interaction.user.toString()}\nРоль: ${role.toString()}`, 0x57F287, interaction.user));
    }
  } else if (action === "give") {
    if (interaction.member.roles.cache.has(roleId)) {
      await interaction.reply({ content: `Роль ${role.toString()} уже есть.`, ephemeral: true });
      return;
    }
    await interaction.member.roles.add(role, "Fail give");
    await interaction.reply({ content: `Роль ${role.toString()} выдана.`, ephemeral: true });
    await sendLog(interaction.guild, makeLogEmbed("Роль выдана", `${interaction.user.toString()}\nРоль: ${role.toString()}`, 0x57F287, interaction.user));
  } else if (action === "remove") {
    if (!interaction.member.roles.cache.has(roleId)) {
      await interaction.reply({ content: `Роли ${role.toString()} и так нет.`, ephemeral: true });
      return;
    }
    await interaction.member.roles.remove(role, "Fail remove");
    await interaction.reply({ content: `Роль ${role.toString()} снята.`, ephemeral: true });
    await sendLog(interaction.guild, makeLog_embed("Роль снята", `${interaction.user.toString()}\nРоль: ${role.toString()}`, 0xE67E22, interaction.user));
  }
}

// ===== ПОДГОТОВКА СЕЛЕКТОВ ДЛЯ ИНТЕРАКЦИЙ =====
async function handleRoleSelectCallback(interaction, values, rolesList) {
  const now = Date.now() / 1000;
  const changed = [];
  
  for (const val of values) {
    const rid = val;
    const role = interaction.guild.roles.cache.get(rid) || await interaction.guild.roles.fetch(rid).catch(() => null);
    if (!role) {
      await interaction.reply({ content: "Роль удалена на сервере.", ephemeral: true });
      return;
    }
    const ck = `rolesel_${interaction.user.id}_${rid}`;
    const last = COOLDOWNS[ck] || 0;
    const rem = COOLDOWN_SECONDS - (now - last);
    if (rem > 0) continue;
    
    COOLDOWNS[ck] = now;
    if (interaction.member.roles.cache.has(rid)) {
      await interaction.member.roles.remove(role, "Выбор ролей");
      changed.push({ role, added: false });
    } else {
      await interaction.member.roles.add(role, "Выбор ролей");
      changed.push({ role, added: true });
    }
  }

  if (changed.length === 0) {
    const m = Math.floor(COOLDOWN_SECONDS / 60);
    const s = Math.floor(COOLDOWN_SECONDS % 60);
    await interaction.reply({ content: `Подождите ${m} мин ${s} сек между действиями с одной ролью.`, ephemeral: true });
    return;
  }

  const lines = [];
  for (const { role, added } of changed) {
    const em = added ? "✅" : "❌";
    lines.push(`${em} ${role.toString()} ${added ? 'выдана' : 'снята'}`);
    const logTitle = added ? "Роль выдана" : "Роль снята";
    await sendLog(interaction.guild, makeLogEmbed(logTitle, `${interaction.user.toString()}\nРоль: ${role.toString()}`, added ? 0x57F287 : 0xE67E22, interaction.user));
  }
  await interaction.reply({ content: lines.join("\n"), ephemeral: true });
}

// ===== СОБЫТИЯ =====
client.once('ready', async () => {
  console.log(`[+] Бот ${client.user.tag} запущен!`);
  client.user.setPresence({
    status: 'dnd',
    activities: [{ name: "ПУМА MARIA BOGINYA", type: ActivityType.Listening }]
  });

  const guilds = await getAllowedGuilds();
  if (guilds.length > 0) {
    for (const [id, g] of client.guilds.cache) {
      if (!guilds.includes(Number(id))) {
        try {
          console.log(`[-] Выход с ${g.name} (${id})`);
          await g.leave();
        } catch {}
      }
    }
  }

  // Регистрация слэш-команд
  const data = [
    {
      name: 'roleeveryone',
      description: 'Установить роль для @everyone'
    },
    {
      name: 'logchatset',
      description: 'Установить канал логов'
    },
    {
      name: 'setrole',
      description: 'Назначить роль для команд'
    },
    {
      name: 'setroles',
      description: 'Отправить меню выбора ролей с кнопками'
    },
    {
      name: 'setwelcome',
      description: 'Выбрать канал для приветствий'
    },
    {
      name: 'setboost',
      description: 'Выбрать канал для бустов'
    },
    {
      name: 'setowner',
      description: 'Установить владельца бота',
      options: [{
        name: 'user',
        type: 6, // USER
        description: 'Новый владелец',
        required: true
      }]
    }
  ];

  await client.application.commands.set(data).catch(console.error);
  console.log("[+] Слэш-команды зарегистрированы!");
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;

    if (commandName === 'setowner') {
      if (!interaction.member.permissions.has('Administrator')) {
        await interaction.reply({ content: "Нет доступа", ephemeral: true });
        return;
      }
      const current = await getSetting("owner_id");
      if (current && interaction.user.id !== current) {
        await interaction.reply({ content: "Владелец уже установлен", ephemeral: true });
        return;
      }
      const targetUser = interaction.options.getUser('user');
      await setSetting("owner_id", targetUser.id);
      await interaction.reply({ content: `Владелец установлен: ${targetUser.toString()}`, ephemeral: true });
      return;
    }

    // Проверка доступа для других команд
    if (!(await checkAccess(interaction))) {
      await interaction.reply({ content: "Нет доступа", ephemeral: true });
      return;
    }

    if (commandName === 'setroles') {
      await interaction.reply({ content: "✅ Сообщение с ролями отправляется...", ephemeral: true });

      // Одно цельное Embed-сообщение без .setColor(), содержащее ссылки на GIF-баннеры
      const desc = [
        "https://i.ibb.co/68Wc6bby/profile.png",
        "",
        "Получи интересующие тебя **роли уведомлений**, которые ты бы не хотел пропускать. Для этого **выбери роли** из списка ниже.",
        "",
        "────────────────────────────────────────────",
        "",
        "https://i.ibb.co/YFp9Y3gW/cozy-roles.png",
        "",
        "Получи интересующие тебя **роли увлечений**, чтобы получать уведомления на интересующие тебя **ивенты**. Для этого **выбери роли** из списка ниже.",
        "",
        "────────────────────────────────────────────",
        "",
        "https://i.ibb.co/Pv0GswT0/gaming-roles.png",
        "",
        "Выбери роль **пола**, чтобы участники сервера могли лучше понимать, как к тебе обращаться."
      ].join("\n");

      const embed = new EmbedBuilder().setDescription(desc);

      const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("roles_notifications")
          .setLabel("Список ролей уведомлений")
          .setEmoji(BUTTON_EMOJI)
          .setStyle(ButtonStyle.Secondary)
      );

      const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("roles_hobbies")
          .setLabel("Список ролей увлечений")
          .setEmoji(BUTTON_EMOJI)
          .setStyle(ButtonStyle.Secondary)
      );

      const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("roles_gender")
          .setLabel("Список ролей пола")
          .setEmoji(BUTTON_EMOJI)
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.channel.send({
        embeds: [embed],
        components: [row1, row2, row3]
      });
    }

    if (commandName === 'roleeveryone') {
      // Логика аналогичная Python-коду, реализуем через Select-меню в Ephemeral
      const roles = interaction.guild.roles.cache.filter(r => r.name !== '@everyone').first(25);
      const select = new StringSelectMenuBuilder()
        .setCustomId('everyone_role_select')
        .setPlaceholder('Выберите роль')
        .addOptions(roles.map(r => new StringSelectMenuOptionBuilder().setLabel(r.name).setValue(r.id)));
      await interaction.reply({ content: "Выберите роль для @everyone:", components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
    }

    if (commandName === 'logchatset') {
      const channels = interaction.guild.channels.cache.filter(c => c.type === 0).first(25); // TEXT CHANNELS
      const select = new StringSelectMenuBuilder()
        .setCustomId('log_channel_select')
        .setPlaceholder('Выберите канал')
        .addOptions(channels.map(c => new StringSelectMenuOptionBuilder().setLabel(`#${c.name}`).setValue(c.id)));
      await interaction.reply({ content: "Выберите канал для логов:", components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
    }

    if (commandName === 'setrole') {
      const roles = interaction.guild.roles.cache.filter(r => r.name !== '@everyone').first(25);
      const select = new StringSelectMenuBuilder()
        .setCustomId('allowed_role_select')
        .setPlaceholder('Выберите роль')
        .addOptions(roles.map(r => new StringSelectMenuOptionBuilder().setLabel(r.name).setValue(r.id)));
      await interaction.reply({ content: "Выберите роль для доступа к командам:", components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
    }

    if (commandName === 'setwelcome') {
      const channels = interaction.guild.channels.cache.filter(c => c.type === 0).first(25);
      const select = new StringSelectMenuBuilder()
        .setCustomId('welcome_channel_select')
        .setPlaceholder('Выберите канал')
        .addOptions(channels.map(c => new StringSelectMenuOptionBuilder().setLabel(`#${c.name}`).setValue(c.id)));
      await interaction.reply({ content: "Выберите канал приветствий:", components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
    }

    if (commandName === 'setboost') {
      const channels = interaction.guild.channels.cache.filter(c => c.type === 0).first(25);
      const select = new StringSelectMenuBuilder()
        .setCustomId('boost_channel_select')
        .setPlaceholder('Выберите канал')
        .addOptions(channels.map(c => new StringSelectMenuOptionBuilder().setLabel(`#${c.name}`).setValue(c.id)));
      await interaction.reply({ content: "Выберите канал бустов:", components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
    }
  }

  // ОБРАБОТКА КОМПОНЕНТОВ (КНОПКИ И СЕЛЕКТЫ)
  if (interaction.isButton()) {
    const { customId } = interaction;
    if (customId.startsWith("fail_btn_")) {
      await handleDatabaseButton(interaction, customId);
      return;
    }

    if (customId === "roles_notifications") {
      const opts = [];
      for (const [rid, label] of NOTIFICATION_ROLES) {
        const r = interaction.guild.roles.cache.get(String(rid)) || await interaction.guild.roles.fetch(String(rid)).catch(() => null);
        if (r) opts.push(new StringSelectMenuOptionBuilder().setLabel(label).setValue(String(rid)));
      }
      if (opts.length === 0) {
        await interaction.reply({ content: "Роли уведомлений не найдены.", ephemeral: true });
        return;
      }
      const select = new StringSelectMenuBuilder()
        .setCustomId("notifications_select")
        .setPlaceholder("Выберите роли уведомлений")
        .setMinValues(0)
        .setMaxValues(opts.length)
        .addOptions(opts);
      await interaction.reply({ content: "Выберите роли уведомлений:", components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
    }

    if (customId === "roles_hobbies") {
      const opts = [];
      for (const [rid, label] of UVLECHENIYA_ROLES) {
        const r = interaction.guild.roles.cache.get(String(rid)) || await interaction.guild.roles.fetch(String(rid)).catch(() => null);
        if (r) opts.push(new StringSelectMenuOptionBuilder().setLabel(label).setValue(String(rid)));
      }
      if (opts.length === 0) {
        await interaction.reply({ content: "Роли увлечений не найдены.", ephemeral: true });
        return;
      }
      const select = new StringSelectMenuBuilder()
        .setCustomId("hobbies_select")
        .setPlaceholder("Выберите роли увлечений")
        .setMinValues(0)
        .setMaxValues(opts.length)
        .addOptions(opts);
      await interaction.reply({ content: "Выберите роли увлечений:", components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
    }

    if (customId === "roles_gender") {
      const opts = [];
      for (const [rid, label] of POL_ROLES) {
        const r = interaction.guild.roles.cache.get(String(rid)) || await interaction.guild.roles.fetch(String(rid)).catch(() => null);
        if (r) opts.push(new StringSelectMenuOptionBuilder().setLabel(label).setValue(String(rid)));
      }
      if (opts.length === 0) {
        await interaction.reply({ content: "Роли пола не найдены.", ephemeral: true });
        return;
      }
      const select = new StringSelectMenuBuilder()
        .setCustomId("gender_select")
        .setPlaceholder("Выберите пол")
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(opts);
      await interaction.reply({ content: "Выберите пол:", components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
    }
  }

  if (interaction.isStringSelectMenu()) {
    const { customId, values } = interaction;

    if (customId === "notifications_select") {
      await handleRoleSelectCallback(interaction, values, NOTIFICATION_ROLES);
    }
    if (customId === "hobbies_select") {
      await handleRoleSelectCallback(interaction, values, UVLECHENIYA_ROLES);
    }
    if (customId === "gender_select") {
      await handleRoleSelectCallback(interaction, values, POL_ROLES);
    }

    // Сохранение настроек из Ephemeral селектов
    if (customId === "everyone_role_select") {
      await setSetting("everyone_role_id", values[0]);
      await interaction.update({ content: `✅ Роль @everyone установлена.`, components: [] });
    }
    if (customId === "log_channel_select") {
      await setSetting("log_channel_id", values[0]);
      await interaction.update({ content: `✅ Канал логов установлен.`, components: [] });
    }
    if (customId === "allowed_role_select") {
      await addAllowedRole(Number(values[0]));
      await interaction.update({ content: `✅ Роль добавлена в белый список.`, components: [] });
    }
    if (customId === "welcome_channel_select") {
      await setSetting("welcome_channel_id", values[0]);
      await interaction.update({ content: `✅ Канал приветствий установлен.`, components: [] });
    }
    if (customId === "boost_channel_select") {
      await setSetting("boost_channel_id", values[0]);
      await interaction.update({ content: `✅ Канал бустов установлен.`, components: [] });
    }
  }
});

// ===== СОБЫТИЯ СЕРВЕРА И ЛОГИ =====
client.on('messageDelete', async (message) => {
  if (message.author?.bot || !message.guild) return;
  await deleteButton(message.id).catch(() => null);

  const embed = makeLogEmbed("Удаление", `**Канал:** ${message.channel.toString()}\n**Автор:** ${message.author.toString()}`, 0xED4245, message.author);
  if (message.content) embed.addFields({ name: "**Содержимое:**", value: `\`\`\`${message.content.substring(0, 1000)}\`\`\`` });
  if (message.attachments.size > 0) embed.addFields({ name: "Вложения", value: `${message.attachments.size} файл(ов)` });
  await sendLog(message.guild, embed);
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (oldMessage.author?.bot || !oldMessage.guild || oldMessage.content === newMessage.content) return;
  const embed = makeLogEmbed("Редактирование", `**Канал:** ${oldMessage.channel.toString()}\n**Автор:** ${oldMessage.author.toString()}`, 0xE67E22, oldMessage.author);
  embed.addFields(
    { name: "**До:**", value: oldMessage.content?.substring(0, 1024) || "Пусто" },
    { name: "**После:**", value: newMessage.content?.substring(0, 1024) || "Пусто" }
  );
  await sendLog(oldMessage.guild, embed);
});

client.on('guildMemberRemove', async (member) => {
  const embed = makeLogEmbed("Выход / Кик", `**Участник:** ${member.toString()} (\`${member.id}\`)`, 0x95A5A6, member.user);
  await sendLog(member.guild, embed);
});

client.on('guildBanAdd', async (ban) => {
  const embed = makeLogEmbed("Бан", `**Пользователь:** ${ban.user.toString()} (\`${ban.user.id}\`)`, 0xED4245);
  await sendLog(ban.guild, embed);
});

client.on('guildBanRemove', async (ban) => {
  const embed = makeLogEmbed("Разбан", `**Пользователь:** ${ban.user.toString()} (\`${ban.user.id}\`)`, 0x57F287);
  await sendLog(ban.guild, embed);
});

client.on('channelCreate', async (channel) => {
  if (!channel.guild) return;
  const embed = makeLogEmbed("Создание канала", `**${channel.name}**\nТип: ${channel.type}`, 0x57F287);
  await sendLog(channel.guild, embed);
});

client.on('channelDelete', async (channel) => {
  if (!channel.guild) return;
  const embed = makeLogEmbed("Удаление канала", `**${channel.name}**\nТип: ${channel.type}`, 0xED4245);
  await sendLog(channel.guild, embed);
});

client.on('roleCreate', async (role) => {
  const embed = makeLogEmbed("Создание роли", `**${role.name}**\nID: ${role.id}`, 0x57F287);
  await sendLog(role.guild, embed);
});

client.on('roleDelete', async (role) => {
  const embed = makeLogEmbed("Удаление роли", `**${role.name}**\nID: ${role.id}`, 0xED4245);
  await sendLog(role.guild, embed);
});

client.on('guildMemberAdd', async (member) => {
  const wci = await getSetting("welcome_channel_id");
  if (wci && /^\d+$/.test(wci)) {
    const ch = member.guild.channels.cache.get(wci) || await member.guild.channels.fetch(wci).catch(() => null);
    if (ch) {
      const text = WELCOME_TEXT.replace("{user}", member.toString()).replace("{name}", member.user.username).replace("{server}", member.guild.name);
      await ch.send({ embeds: [new EmbedBuilder().setDescription(text).setColor(0x57F287)] }).catch(() => null);
    }
  }
});

// ===== АНТИФЛУД И НОЧНОЙ @EVERYONE =====
const messageCache = {};
const FLOOD_LIMIT = 5;
const FLOOD_INTERVAL = 5;

client.on('messageCreate', async (msg) => {
  if (msg.author.bot || !msg.guild) return;

  const uid = msg.author.id;
  const now = Date.now() / 1000;
  if (!messageCache[uid]) messageCache[uid] = [];
  messageCache[uid] = messageCache[uid].filter(m => now - m.time < FLOOD_INTERVAL);
  messageCache[uid].push({ time: now, content: msg.content });

  if (messageCache[uid].length > FLOOD_LIMIT && !msg.member.permissions.has('Administrator')) {
    await msg.delete().catch(() => null);
    const warn = await msg.channel.send(`${msg.author.toString()} **Не флуди!**`).catch(() => null);
    if (warn) setTimeout(() => warn.delete().catch(() => null), 3000);
    await sendLog(msg.guild, makeLogEmbed("Флуд", `${msg.author.toString()}\n**Канал:** ${msg.channel.toString()}`, 0xED4245, msg.author));
    return;
  }

  // Тег @everyone ночью
  const hasEveryone = msg.mentions.everyone;
  if (hasEveryone && isNightTime() && !msg.member.permissions.has('Administrator')) {
    const erid = await getSetting("everyone_role_id");
    let hasRole = false;
    if (erid) {
      hasRole = msg.member.roles.cache.has(erid);
    }
    if (!hasRole) {
      const embed = makeLogEmbed("Тег @everyone ночью", `${msg.author.toString()}\n**Канал:** ${msg.channel.toString()}`, 0x9B59B6, msg.author);
      embed.addFields({ name: "Действие:", value: "Мут на 7 дней" });
      await sendLog(msg.guild, embed);
      await msg.delete().catch(() => null);
      await msg.member.timeout(7 * 24 * 3600 * 1000, "everyone ночью").catch(() => null);
      const warn = await msg.channel.send(`${msg.author.toString()} **Мут на 7 дней**`).catch(() => null);
      if (warn) setTimeout(() => warn.delete().catch(() => null), 10000);
      return;
    }
  }

  // Реклама
  if (hasAdKeywords(msg.content) && !msg.member.permissions.has('Administrator')) {
    const erid = await getSetting("everyone_role_id");
    let hasRole = false;
    if (erid) hasRole = msg.member.roles.cache.has(erid);
    if (!hasRole) {
      await sendLog(msg.guild, makeLogEmbed("Реклама", `${msg.author.toString()}\n**Канал:** ${msg.channel.toString()}`, 0xED4245, msg.author));
      await msg.delete().catch(() => null);
      const warn = await msg.channel.send(`${msg.author.toString()} **Реклама запрещена!**`).catch(() => null);
      if (warn) setTimeout(() => warn.delete().catch(() => null), 5000);
    }
  }
});

// ===== СТАРТ БОТА =====
(async () => {
  await initDb();
  const token = loadToken();
  if (!token) {
    console.log("[-] Токен не найден!");
    process.exit(1);
  }
  client.login(token);
})();