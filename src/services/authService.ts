import { signInWithEmailAndPassword } from "firebase/auth";
import { collection, query, where, getDocs } from "firebase/firestore";
import { auth, db } from "./firebase.ts";

export async function loginWithUsername(usernameInput: string, passwordInput: string) {
  try {
    const formattedUsername = usernameInput.trim().toLowerCase();

    // 1. Menggunakan format email internal yang terdaftar di Firebase Authentication
    const emailFormat = `${formattedUsername}@rshl.id`;

    // 2. Verifikasi autentikasi username & password ke Firebase Auth
    await signInWithEmailAndPassword(auth, emailFormat, passwordInput);

    // 3. Mengambil data dari koleksi 'master_nurses' sesuai struktur database Anda
    const nursesRef = collection(db, "master_nurses");
    const q = query(nursesRef, where("username", "==", formattedUsername));
    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
      // Mengambil data dokumen perawat pertama yang ditemukan
      const nurseDoc = querySnapshot.docs[0];
      const userData = nurseDoc.data();

      return {
        success: true,
        role: userData.role, // Membaca data 'pj_shift'
        nama: userData.name   // Membaca nama 'M HAIKAL MALILANG'
      };
    } else {
      throw new Error("Data perawat tidak ditemukan di database master_nurses.");
    }
  } catch (error: any) {
    console.error("Authentication Error:", error.message);
    throw new Error("Username atau Password salah. Silakan periksa kembali.");
  }
}