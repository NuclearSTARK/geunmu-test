import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
    import { getDatabase, ref, set, onValue, get } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js";

    const firebaseConfig = {
      apiKey: "AIzaSyBIXM13hlgSr8uBA1FWMbRe0biUoYCFVIY",
      authDomain: "genumu.firebaseapp.com",
      databaseURL: "https://genumu-default-rtdb.asia-southeast1.firebasedatabase.app",
      projectId: "genumu",
      storageBucket: "genumu.firebasestorage.app",
      messagingSenderId: "693743020224",
      appId: "1:693743020224:web:cf8ca4c16a8738cc3da525",
      measurementId: "G-WW31X1NG1Q"
    };

    const app = initializeApp(firebaseConfig);
    const db = getDatabase(app);

    window.firebaseDB = {
      save: (path, data) => set(ref(db, path), data),
      read: (path) => get(ref(db, path)).then(snap => snap.val()),
      listen: (path, callback) => onValue(ref(db, path), snap => callback(snap.val()))
    };

    window.dispatchEvent(new Event("firebase-ready"));
