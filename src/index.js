require('dotenv').config();

const axios = require('axios');
const express = require('express');
const bodyParser = require('body-parser');
const message = require('./message');

const accessControlList = require('../acl.json');
const recentAuthentications = new Map();

const app = express();

const DOOR_URL = process.env.DOOR_URL;
const SLACK_TEAM = process.env.SLACK_TEAM;
const SLACK_REPORT_CHANNEL = process.env.SLACK_REPORT_CHANNEL;
const SLACK_VERIFICATION_TOKEN = process.env.SLACK_VERIFICATION_TOKEN;

function openDoor(door) {
  return axios.get(`${DOOR_URL}/${door}`);
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

  // FIXME: Check Token,Door-Combination

  rfiduid = rfiduid.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (rfiduid.length === 0) {
    res.status(400).send({ err: 'no uid' });
    return;
  }
  
  if (!accessControlList.hasOwnProperty(rfiduid)) {
    res.status(401).send({ err: 'no user' });
    return;
  }

  const slackUid = accessControlList[rfiduid];

  if (recentAuthentications.has(slackUid) && recentAuthentication.get(slackUid) < (Date.now() + 60000)) {
    // skip second factor
    openDoor(door);
    res.status(200).send({ ok: true });
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

  if (actionType === 'open') {
    recentAuthentications.set(user, Date.now());
    openDoor(data.door)
      .then(() => res.send({ text: `:white_check_mark: Du hast die Tür *${data.door}* geöffnet` }))
      .catch(() => res.send({ text: `Die Tür *${data.door}* konnte nicht geöffnet werden, versuch es doch später noch einmal` }));
    return;
  }

  if (actionType === 'report') {
    message.sendReport(SLACK_TEAM, SLACK_REPORT_CHANNEL, slackUid, door);
    res.send({ text: `Der Öffnungsversuch wurde verhindert und gemeldet` });
    return;
  }
});

app.listen(process.env.PORT, () => {
  console.log(`App listening on port ${process.env.PORT}!`);
});
