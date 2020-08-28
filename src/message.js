const qs = require('querystring');
const axios = require('axios');
const crypto = require('crypto');

const SLACK_TOKEN = process.env.SLACK_TOKEN;
const SECRET = `${process.env.SECRET}-${(+new Date())}-${Math.random()}`;

const sha1 = (input) => { return crypto.createHash('sha1').update(input).digest('hex') };
const postResult = result => console.log(result.data);

const craftId = (doorId, userId, time) => {
  let x = `v1:${doorId}:${userId}:${time}`;
  return x + ':' + sha1(`${x}:${SECRET}`);
}

const sendOpen = async (userId, door) => {
  let now = (+new Date());
  let callback_id = craftId(door.id, userId, now);
  let message = {
    channel: userId,
    as_user: true,
    text: "",
    attachments: [
      {
        text: `<@${userId}> Dein RFID-Tag wurde an der Tür *${door.name}* erkannt`,
        callback_id: callback_id,
        actions: [
          {
            name: 'accept',
            text: 'Tür öffnen',
            type: 'button',
            value: 'open',
            style: 'primary',
          },
          {
            name: 'report',
            text: 'Das war ich nicht!',
            type: 'button',
            value: 'report',
            style: 'danger',
          }
        ],
      }],
  };
	// send the message as a DM to the user
  let sendMessage = await axios.post('https://slack.com/api/chat.postMessage', message, { headers: { 'Authorization': `Bearer ${SLACK_TOKEN}` }});
  postResult(sendMessage);
  return {
    callback_id: callback_id,
    channel: sendMessage.data.channel,
    ts: sendMessage.data.ts
  };
};

const sendConfirmation = async (userId, door) => {
  let now = (+new Date());
  let callback_id = craftId(door.id, userId, now);
  let message = {
    channel: userId,
    as_user: true,
    text: `:white_check_mark: Du hast die Tür *${door.name}* direkt geöffnet`
  };
  // send the message as a DM to the user
  let sendMessage = await axios.post('https://slack.com/api/chat.postMessage', message, { headers: { 'Authorization': `Bearer ${SLACK_TOKEN}` }});
  postResult(sendMessage);
  return {
    callback_id: callback_id,
    channel: sendMessage.data.channel,
    ts: sendMessage.data.ts
  };
};

const replaceOpenTimeout = async (userId, door, msg) => {
  let message = {
    channel: msg.channel,
    as_user: true,
    ts: msg.ts,
    text: "",
    attachments: [
      {
        text: `<@${userId}> Dein RFID-Tag wurde an der Tür *${door.name}* erkannt.\nDie Zeit für die Öffnung ist bereits abgelaufen.`,
        callback_id: msg.callback_id,
        actions: [
          {
            name: 'report',
            text: 'Das war ich nicht!',
            type: 'button',
            value: 'report',
            style: 'danger',
          }
        ],
      }],
  };
  let sendMessage = await axios.post('https://slack.com/api/chat.update', message, { headers: { 'Authorization': `Bearer ${SLACK_TOKEN}` }});
  postResult(sendMessage);
  return {
    callback_id: msg.callback_id,
    channel: sendMessage.data.channel,
    ts: sendMessage.data.ts
  };
};

const sendReport = (reportChannelId, userId, door, time) => {
  const message = {
    channel: reportChannelId,
    token: SLACK_TOKEN,
    text: `<@${userId}> meldet, dass ein Tür-Öffnungsversuch an der Tür *${door.name}* (${time}) unberechtigt ausgelöst wurde`
  };

  // send the message to the report channel
  const sendMessage = axios.post('https://slack.com/api/chat.postMessage', message, { headers: { 'Authorization': `Bearer ${SLACK_TOKEN}` }});
  sendMessage.then(postResult);
};

const sendMessage = (reportChannelId, content) => {
  const message = {
    channel: reportChannelId,
    token: SLACK_TOKEN,
    text: content
  };

  // send the message to the report channel
  const sendMessage = axios.post('https://slack.com/api/chat.postMessage', message, { headers: { 'Authorization': `Bearer ${SLACK_TOKEN}` }});
  sendMessage.then(postResult);
};

const verify = (callback_id) => {
  let cb = extract(callback_id);
  if (cb === false) {
    return false;
  }
  return callback_id === craftId(cb.doorId, cb.userId, cb.time);
};

const extract = (callback_id) => {
  if (callback_id.substr(0, 3) !== 'v1:') {
    return false;
  }
  let [ version, doorId, userId, time, secret ] = callback_id.split(':');
  return { doorId, userId, time };
};

const extractAndVerify = (callback_id) => {
  if (!verify(callback_id)) {
    return false;
  }
  return extract(callback_id);
};

module.exports = { sendOpen, verify, extractAndVerify, replaceOpenTimeout, sendConfirmation, sendMessage, sendReport };
