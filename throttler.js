const DELAY = 10 * 1000;
const throttleMap = new Map();

module.exports = (call, key, ...args) => {
	// If we haven't executed anything within the last DELAY duration, we execute immediately and mark execution time.
	if (!throttleMap.has(key)) {
		call(...args);
		throttleMap.set(key, [ Date.now() ]);
		return;
	}

		const [oldTime, oldTimeout] = throttleMap.get(key);
		// If something has been executed within the last DELAY duration, we see if something else is waiting to be
		// executed, and if so, we stop it, because we'd rather use the next available execution for this newer call.
		// Or maybe this thing has already executed, we don't care, just get rid of it.
		if (oldTimeout) {
			clearTimeout(oldTimeout);
		}

		const newTime = Date.now();

		// If it's been more than DELAY since our last execution, let's execute right away and mark current execution time.
		if (oldTime + DELAY <= newTime) {
			call(...args);
			throttleMap.set(key, [ newTime ]);
			return;
		}

		// If DELAY duration hasn't occured yet, we create a timeout with our own call instead, but with the same timestamp
		// for last execution. We execute this when the existing call should have occured, i.e. the normal DELAY duration,
		// minus the time that has occured since the original execution was scheduled and now.
		const newTimeout = setTimeout(() => {
			call(...args);
		}, DELAY - (newTime - oldTime));
		throttleMap.set(key, [oldTime, newTimeout]);

};

// House-keepnig to clean up old entries to not leak memory.
setInterval(() => {
	const newTime = Date.now();
	throttleMap.forEach(([oldTime, oldTimeout], key) => {
		if (oldTime + DELAY < newTime) {
			throttleMap.delete(key);
		}
	});
}, 10 * DELAY);