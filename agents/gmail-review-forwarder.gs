/**
 * The Art Spa Tulum — Google review email forwarder (v3)
 * Keep YOUR line "const SECRET = '...';" — paste everything else below it.
 */
const SECRET = 'PASTE-YOUR-SECRET-PHRASE-HERE';

const ENDPOINT = 'https://www.theartspatulum.mx/.netlify/functions/review-email';

function post_(payload) {
  payload.secret = SECRET;
  return UrlFetchApp.fetch(ENDPOINT, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify(payload)
  });
}

function checkReviewEmails() {
  const props = PropertiesService.getScriptProperties();
  const done = JSON.parse(props.getProperty('doneIds') || '[]');
  const query = 'from:google.com newer_than:7d (review OR reviews OR reseña OR reseñas OR opinión)';
  const threads = GmailApp.search(query, 0, 30);
  var found = 0, fresh = 0;
  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (msg) {
      if (msg.getDate() < new Date(Date.now() - 7 * 24 * 3600 * 1000)) return;
      found++;
      const id = msg.getId();
      if (done.indexOf(id) !== -1) return;
      fresh++;
      const res = post_({ id: id, subject: msg.getSubject(), body: msg.getPlainBody(), date: msg.getDate() });
      Logger.log(msg.getSubject() + ' -> ' + res.getResponseCode() + ' ' + res.getContentText());
      if (res.getResponseCode() === 200) done.push(id);
    });
  });
  props.setProperty('doneIds', JSON.stringify(done.slice(-300)));
  // Tell the website the check ran (shows on the status page)
  const ping = post_({ ping: true, found: found, fresh: fresh });
  Logger.log('Check finished: ' + found + ' review emails, ' + fresh + ' new -> website said ' + ping.getResponseCode());
}

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('checkReviewEmails').timeBased().everyMinutes(10).create();
  checkReviewEmails();
}
