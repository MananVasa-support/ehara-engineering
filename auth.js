// auth.js — Initializes Firebase from window.AUTH_CONFIG and exposes window.Auth.
(function () {
  if (!window.AUTH_CONFIG) {
    console.error("auth.js: window.AUTH_CONFIG missing. Include auth-config.js first.");
    return;
  }
  if (typeof firebase === "undefined") {
    console.error("auth.js: Firebase SDK missing. Include firebase-app-compat + firebase-auth-compat scripts first.");
    return;
  }

  firebase.initializeApp(window.AUTH_CONFIG);
  const auth = firebase.auth();

  async function signIn(email, password, keepSignedIn) {
    const persistence = keepSignedIn
      ? firebase.auth.Auth.Persistence.LOCAL
      : firebase.auth.Auth.Persistence.SESSION;
    await auth.setPersistence(persistence);
    const cred = await auth.signInWithEmailAndPassword(email, password);
    return cred.user;
  }

  async function sendReset(email) { await auth.sendPasswordResetEmail(email); }
  async function signOut() { await auth.signOut(); }

  function guardPage(options) {
    const redirectTo = (options && options.redirectTo) || "index.html";
    auth.onAuthStateChanged(function (user) {
      if (!user) {
        window.location.replace(redirectTo);
      } else {
        document.documentElement.style.visibility = "visible";
      }
    });
  }

  function redirectIfSignedIn(target) {
    auth.onAuthStateChanged(function (user) {
      if (user) window.location.replace(target || "dashboard.html");
    });
  }

  function friendlyError(err) {
    const code = (err && err.code) || "";
    if (code === "auth/wrong-password" || code === "auth/user-not-found" || code === "auth/invalid-credential" || code === "auth/invalid-email") {
      return "Incorrect email or password.";
    }
    if (code === "auth/too-many-requests") return "Too many attempts. Try again in a few minutes.";
    if (code === "auth/network-request-failed") return "Couldn't reach the server. Check your connection and try again.";
    return "Something went wrong. Please try again.";
  }

  window.Auth = { signIn, sendReset, signOut, guardPage, redirectIfSignedIn, friendlyError };
})();