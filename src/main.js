import { Telegraf, session } from 'telegraf';
import config from 'config';
import { code } from 'telegraf/format';
import { ogg } from './ogg.js';
import { openai } from './openai.js';
import pTimeout from 'p-timeout';

const bot = new Telegraf(config.get('TELEGRAM_TOKEN'));

const INITIAL_SESSION = {
  messages: [],
};

const MAX_MESSAGE_LENGTH = 4096;


bot.use(session());

let admins = ['618628269', '169259069'];

bot.command('clear', async (ctx) => {
  if (admins.includes(ctx.message.from.id.toString())) {
    ctx.session = INITIAL_SESSION;
    if (ctx.session.messages && ctx.session.messages.length > 0) {
      ctx.session.messages = [];
      await ctx.reply('Контекст диалога очищен.');
    } else {
      await ctx.reply('Нет диалога для очистки.');
    }
  } else {
    await ctx.reply('Вы не авторизованы для выполнения этой команды.');
  }
});

bot.command('help', async (ctx) => {
  const commands = [ 
    { command: '/clear', description: ' Очищает контекст текущего диалога' },
    { command: '/help', description: ' Выводит список доступных команд' },
  ];

  const helpMessage = commands
    .map(({ command, description }) => `${command} - ${description}`)
    .join('\n');

  await ctx.reply(helpMessage);
});

async function sendResponseChunks(ctx, chunks) {
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    await ctx.reply(chunk);
  }
}

function splitResponseIntoChunks(response) {
  const MAX_MESSAGE_LENGTH = 4096;
  const chunks = [];
  let start = 0;

  while (start < response.length) {
    const chunk = response.substr(start, MAX_MESSAGE_LENGTH);
    chunks.push(chunk);
    start += MAX_MESSAGE_LENGTH;
  }
Как
  return chunks;
}  

bot.on('voice', async (ctx) => {
  if (admins.includes(ctx.message.from.id.toString())) {
    ctx.session ??= INITIAL_SESSION;
    try {
      await ctx.reply(code('Сообщение принято. Ожидайте ответа от ChatGPT'));
      const link = await ctx.telegram.getFileLink(ctx.message.voice.file_id);
      const userId = String(ctx.message.from.id);
      const oggPath = await ogg.create(link.href, userId);
      const mp3Path = await ogg.toMp3(oggPath, userId);

      const text = await openai.transcription(mp3Path);
      await ctx.reply(code(`Ваш запрос: ${text}`));

      ctx.session.messages.push({ role: openai.roles.USER, content: text });

      await delay(3000);

      const response = await openai.chat(ctx.session.messages);

      ctx.session.messages.push({
        role: openai.roles.USER,
        content: response.content,
      });

      const content = response.content;

      if (content.length <= MAX_MESSAGE_LENGTH) {
        await ctx.reply(content);
      } else {
        const chunks = splitResponseIntoChunks(content);
        await sendResponseChunks(ctx, chunks);
      }

    } catch (e) {
      console.log('Error while voice message', e.message);
      process.exit(1);
    }
  } else {
    await ctx.reply('Вы не авторизованы для отправки голосовых сообщений.');
  }
});

bot.on('text', async (ctx) => {
  if (admins.includes(ctx.message.from.id.toString())) {
    ctx.session ??= INITIAL_SESSION;
    try {
      const text = ctx.message.text;
      await ctx.reply(code('Сообщение принято. Ожидайте ответа от ChatGPT'));

      const response = await pTimeout(new Promise((resolve, reject) => {
        ctx.session.messages.push({ role: openai.roles.USER, content: text });

        resolve(openai.chat(ctx.session.messages));
      }), 600000, 'Время ожидания истекло.');

      const content = response.content;

      if (content.length <= MAX_MESSAGE_LENGTH) {
        await ctx.reply(content);
      } else {
        const chunks = splitResponseIntoChunks(content);
        await sendResponseChunks(ctx, chunks);
      }

      ctx.session.messages.push({
        role: openai.roles.USER,
        content: response.content,
      });

    } catch (e) {
      console.log('Error while handling text message', e.message);
      process.exit(1);
    }
  } else {
    await ctx.reply('Вы не авторизованы для отправки текстовых сообщений.');
  }
});

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
