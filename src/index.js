require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const net = require('net');

const axios = require('axios');
const express = require('express');
const bodyParser = require('body-parser');
const YAML = require('yaml');
const message = require('./message');

const file = fs.readFileSync('./config.yml', 'utf8');
const cfg = YAML.parse(file);
const accessControlList = cfg.acl;
const recentAuthentications = new Map();

const app = express();

const SLACK_TEAM = process.env.SLACK_TEAM;
const SLACK_REPORT_CHANNEL = process.env.SLACK_REPORT_CHANNEL;
const SLACK_VERIFICATION_TOKEN = process.env.SLACK_VERIFICATION_TOKEN;
const DOOR_SECRET = Buffer.from(process.env.DOOR_SECRET, 'hex');
const DOOR_PORT = parseInt(process.env.DOOR_PORT);
const DOOR_HOST = process.env.DOOR_HOST;

function openDoor(door) {
  return new Promise(async (resolve, reject) => {
    try {
      const client = new net.Socket();
      await client.connect(DOOR_PORT, DOOR_HOST);
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
        if (buffer.readUInt8(buffer.length - 1) === 0) {
            resolve();
        } else {
            reject();
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

// parse application/x-www-form-urlencoded && application/json
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.get('/', (req, res) => {
  res.send('<h2>The Door Handler is running</h2>' +
    '<p>Follow the instructions in the README to configure ' +
    'the Slack App and your environment variables.</p>');
});

/**
 * Endpoint for the door devices
 */
app.get('/open', (req, res) => {
  let { token, door, rfiduid } = req.query;

  if (typeof token === 'undefined' || typeof door === 'undefined' || typeof rfiduid === 'undefined') {
    res.sendStatus(400);
    return;
  }

  doorId = parseInt(door);
  door = cfg.door.find((v) => v.id == doorId);
  if (!door || door.token !== token) {
    res.status(401).send({ err: 'no door' });
    return;
  }

  rfiduid = rfiduid.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (rfiduid.length === 0) {
    res.status(400).send({ err: 'no uid' });
    return;
  }
  
  const aclEntry = accessControlList.find((v) => v.rfiduid === rfiduid);

  if (!aclEntry) {
    res.status(401).send({ err: 'no user' });
    return;
  }

  const slackUid = aclEntry.slackuid;

  if (recentAuthentications.has(slackUid) && recentAuthentication.get(slackUid) < (Date.now() + 60000)) {
    // skip second factor
    openDoor(door)
      .then(() => res.status(200).send({ ok: true }))
      .catch(() => res.status(500).send({ ok: false }));
  } else {
    // use slack as second factor
    message.sendOpen(SLACK_TEAM, slackUid, door);
    res.status(200).send({ ok: true });
  }
});


/*
 * Endpoint to receive events from interactive message on Slack. Checks the
 * verification token before continuing.
 */
app.post('/interactive-message', (req, res) => {
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

  let doorId = parseInt(data.doorId);
  const door = cfg.door.find((v) => v.id == doorId);
  if (!door) {
    res.status(401).send({ err: 'door unknown' });
    return;
  }

  if (actionType === 'open') {
    recentAuthentications.set(user, Date.now());
      .then(() => res.send({ text: `:white_check_mark: Du hast die Tür *${data.door}* geöffnet` }))
      .catch(() => res.send({ text: `Die Tür *${data.door}* konnte nicht geöffnet werden, versuch es doch später noch einmal` }));
    openDoor(door.id)
    return;
  }

  if (actionType === 'report') {
    message.sendReport(SLACK_TEAM, SLACK_REPORT_CHANNEL, user, door);
    res.send({ text: `Der Öffnungsversuch wurde verhindert und gemeldet` });
    return;
  }
});

app.listen(process.env.PORT, () => {
  console.log(`App listening on port ${process.env.PORT}!`);
});
