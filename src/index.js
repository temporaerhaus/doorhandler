require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const net = require('net');

const axios = require('axios');
const express = require('express');
const bodyParser = require('body-parser');
const rateLimit = require('express-rate-limit');
const YAML = require('yaml');
const message = require('./message');

const file = fs.readFileSync('./config.yml', 'utf8');
const cfg = YAML.parse(file);
const accessControlList = cfg.acl;
const recentAuthentications = new Map();
const recentAttempts = new Map();
const lastMessages = new Map();

const app = express();
const slackApp = express();

const SLACK_TEAM = process.env.SLACK_TEAM;
const SLACK_REPORT_CHANNEL = process.env.SLACK_REPORT_CHANNEL;
const SLACK_VERIFICATION_TOKEN = process.env.SLACK_VERIFICATION_TOKEN;
const DOOR_SECRET = Buffer.from(process.env.DOOR_SECRET, 'hex');
const DOOR_PORT = parseInt(process.env.DOOR_PORT);
const DOOR_HOST = process.env.DOOR_HOST;

const TIME_BETWEEN_UID_ATTEMPTS = 10000;
const TIME_2FA_NO_REAUTH_NEEDED = 60000;
const TIME_2FA_EXPIRING = 120000;
const TIMEOUT_OPENER_HEALTHY = 120000;
const TIMEOUT_UNHEALTHY_REMINDER = 4 * 60 * 60 * 1000;

function openDoor(door) {
  try {
    const client = new net.Socket();
    client.connect(DOOR_PORT, DOOR_HOST);
    return new Promise((resolve, reject) => {
      let buffer = Buffer.alloc(0);
      client.on('data', (data) => {
        buffer = Buffer.concat([buffer, data]);
        if (buffer.length === 4) {
          const response = Buffer.alloc(5);
          response.writeUInt8(door);
          buffer.copy(response, 1, 0, 4);
          const hmac = crypto.createHmac('sha256', DOOR_SECRET);
          hmac.update(response);
          const payload = Buffer.concat([response, hmac.digest()]);
          client.write(payload);
        }
      });
      client.on('close', () => {
        if (buffer.length > 0 && buffer.readUInt8(buffer.length - 1) === 0) {
            resolve();
        } else {
            reject();
        }
      });
      client.on('error', (e) => {
        console.log(e);
        reject(e);
      });
    });
  } catch(e) {
    console.error(e);
    return Promise.reject(e);
  }
}

async function expireMessage(slackUid, door) {
  if (!lastMessages.has(slackUid)) {
    return
  }
  let msg = lastMessages.get(slackUid);
  console.log('expiring message for user', slackUid, msg);
  if (msg !== null) {
    await message.replaceOpenTimeout(slackUid, door, msg);
  }
}

// limit app to 10 requests per second
app.use(rateLimit({ windowMs: 1000, max: 10 }));
slackApp.use(rateLimit({ windowMs: 1000, max: 10 }));

// parse application/x-www-form-urlencoded && application/json
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
slackApp.use(bodyParser.urlencoded({ extended: true }));
slackApp.use(bodyParser.json());

app.get('/', (req, res) => {
  res.send('<h2>The Door Handler (internal) is running</h2>' +
    '<p>Follow the instructions in the README to configure ' +
    'the readers, users and your environment variables.</p>');
});
slackApp.get('/', (req, res) => {
  res.send('<h2>The Door Handler (external) is running</h2>' +
    '<p>Follow the instructions in the README to configure ' +
    'the Slack App and your environment variables.</p>');
});

/**
 * Endpoint for the door devices
 */
app.get('/open', async (req, res) => {
  let { door, rfiduid } = req.query;

  if (typeof door === 'undefined' || typeof rfiduid === 'undefined') {
    res.sendStatus(400);
    return;
  }

  doorId = door;
  door = cfg.door.find((v) => v.id == doorId);
  if (!door) {
    res.status(401).send({ err: 'no door' });
    return;
  }

  rfiduid = rfiduid.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (rfiduid.length === 0) {
    res.status(400).send({ err: 'no uid' });
    return;
  }

  if (recentAttempts.has(rfiduid) && recentAttempts.get(rfiduid) > (Date.now() - TIME_BETWEEN_UID_ATTEMPTS)) {
    res.status(400).send({ err: 'attempt too soon' });
    return;
  }
  
  recentAttempts.set(rfiduid, Date.now());
  const aclEntry = accessControlList.find((v) => v.rfiduid.toLowerCase() === rfiduid);

  if (!aclEntry) {
    res.status(401).send({ err: 'no user' });
    return;
  }

  const slackUid = aclEntry.slackuid;

  if (recentAuthentications.has(slackUid) && recentAuthentications.get(slackUid) > (Date.now() - TIME_2FA_NO_REAUTH_NEEDED)) {
    // skip second factor
    res.status(200).send({ ok: true });
    openDoor(door.relais).then(() => message.sendConfirmation(slackUid, door)).catch(() => console.error);
  } else {
    // use slack as second factor
    await expireMessage(slackUid, door);

    let msg = await message.sendOpen(slackUid, door);
    lastMessages.set(slackUid, msg);
    setTimeout(() => expireMessage(slackUid, door), TIME_2FA_EXPIRING);

    res.status(200).send({ ok: true });
  }
});

/*
 * Endpoint to receive events from interactive message on Slack. Checks the
 * verification token before continuing.
 */
slackApp.post('/interactive-message', (req, res) => {
  const { token, user, team, callback_id, actions } = JSON.parse(req.body.payload);
  if (token !== SLACK_VERIFICATION_TOKEN) {
    res.status(403).send({ err: 'slack verification failed' });
    return;
  }

  if (actions.length !== 1) {
    res.status(403).send({ err: 'action verification failed' });
    return;
  }

  const data = message.extractAndVerify(callback_id);
  if (data === false) {
    res.status(400).send({ err: 'data verification failed' });
    return;
  }

  const actionType = actions[0].value;
  if (actionType !== 'open' && actionType !== 'report') {
    res.status(400).send({ err: 'action unknown' });
    return;
  }

  const door = cfg.door.find((v) => v.id == data.doorId);
  if (!door) {
    res.status(401).send({ err: 'door unknown' });
    return;
  }

  if (actionType === 'open') {
    if (data.time < Date.now() - TIME_2FA_EXPIRING) {
      res.send({ text: `Sorry. Die Zeit für diesen Öffnungsversuch ist bereits abgelaufen. Bitte versuche es erneut` });
      return;
    }
    recentAuthentications.set(user.id, Date.now());
    openDoor(door.relais)
      .then(() => {
        lastMessages.set(user.id, null);
        res.send({ text: `:white_check_mark: Du hast die Tür *${door.name}* geöffnet` });
      })
      .catch(() => {
        lastMessages.set(user.id, null);
        res.send({ text: `Die Tür *${door.name}* konnte nicht geöffnet werden, versuch es doch später noch einmal` });
      });
    return;
  }

  if (actionType === 'report') {
    message.sendReport(SLACK_REPORT_CHANNEL, user.id, door, data.time);
    lastMessages.set(user.id, null);
    res.send({ text: `Der Öffnungsversuch wurde verhindert und gemeldet` });
    return;
  }
});

/**
 * Endpoint for assessing the health status of the opener device
 */
let lastOpenerContact = Date.now();
let lastUnhealthyMessage = 0;
app.get('/opener-alive', (req, res) => {
    lastOpenerContact = Date.now();
    res.status(200).send({ ok: true });
    if (lastUnhealthyMessage > 0) {
        message.sendMessage(
            SLACK_REPORT_CHANNEL,
            'Opener ist wieder da! :tada:'
        );
        lastUnhealthyMessage = 0;
    }
});
setInterval(() => {
    const lastContact = Date.now() - lastOpenerContact;
    const lastMessage = Date.now() - lastUnhealthyMessage;
    if (lastUnhealthyMessage === 0 && lastContact > TIMEOUT_OPENER_HEALTHY &&
        || lastUnhealthyMessage > 0 && lastMessage > TIMEOUT_UNHEALTHY_REMINDER) {
        message.sendMessage(
            SLACK_REPORT_CHANNEL,
            `Opener hat sich seit ${Math.floor(lastContact/1000)}s nicht mehr gemeldet.`
        );
        lastUnhealthyMessage = Date.now();
    }
}, TIMEOUT_OPENER_HEALTHY);

app.listen(process.env.PORT, process.env.INTERNAL_HOST, () => {
  console.log(`App listening on http://${process.env.INTERNAL_HOST}:${process.env.PORT}`);
});
slackApp.listen(process.env.PORT, process.env.EXTERNAL_HOST, () => {
  console.log(`slackApp listening on http://${process.env.EXTERNAL_HOST}:${process.env.PORT}`);
});
