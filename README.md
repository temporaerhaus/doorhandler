# VSH Door Handler

Slack / RFID / LDAP Application for opening doors with an two-factor system.

## Setup

#### Create a Slack app

1. Create an app at api.slack.com/apps
1. Navigate to the Bot Users page and add a bot user
1. Navigate to the Install App page and install the app
1. Copy the `xoxb-` token after the installation process is complete

#### Run locally
1. Get the code
    * Either clone this repo and run `npm install`
1. Set the following environment variables to `.env` (see `.env.sample`):
	* `SLACK_TEAM`: Your team, where the app is installed into
    * `SLACK_TOKEN`: Your app's `xoxb-` token (available on the Install App page)
    * `SLACK_VERIFICATION_TOKEN`: Your app's Verification Token (available on the Basic Information page)
    * `PORT`: The port that you want to run the web server on
1. If you're running the app locally:
    1. Start the app (`npm start`)
    1. In another windown, start ngrok on the same port as your webserver (`ngrok http $PORT`)


#### Enable Interactive Messages

1. In the app settings, click on Interactive Messages
1. Set the Request URL to your URL + /interactive-message


## Thanks
This code is loosely based on https://github.com/slackapi/template-terms-of-service