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

const sendOpen = (teamId, userId, door) => {
  let now = (+new Date());
  let callback_id = craftId(door.id, userId, now);
  let message = {
    channel: userId,
    as_user: true,
    token: SLACK_TOKEN,
    attachments: JSON.stringify([
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
      }]),
  };

	// send the message as a DM to the user
	const params = qs.stringify(message);
	const sendMessage = axios.post('https://slack.com/api/chat.postMessage', params);
	sendMessage.then(postResult);
};

const sendReport = (teamId, reportChannelId, userId, door) => {
  const message = {
    channel: reportChannelId,
    token: SLACK_TOKEN,
    text: `<@${userId}> meldet, dass ein Tür-Öffnungsversuch an der Tür *${door.name}* unberechtigt ausgelöst wurde`
  };

  // send the message to the report channel
  const params = qs.stringify(message);
  const sendMessage = axios.post('https://slack.com/api/chat.postMessage', params);
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

module.exports = { sendOpen, verify, extractAndVerify };
