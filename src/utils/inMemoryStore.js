const store = new Map();

module.exports.getMessages = (sessionId, systemPrompt = null) => {
  if (!store.has(sessionId)) {
    if(!systemPrompt){
        return;
    }
    // initialize with a system prompt
    store.set(sessionId, [{
        role : "system",
        content : systemPrompt,
    }]);
  }
  return store.get(sessionId);
};

module.exports.appendMessage = (sessionId, msg) => {
  getMessages(sessionId).push(msg);
};