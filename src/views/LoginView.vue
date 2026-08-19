<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { auth, db } from '../firebase'
import { signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup } from 'firebase/auth'
import { doc, getDoc, setDoc } from 'firebase/firestore'

const router = useRouter()
const email = ref('')
const password = ref('')
const error = ref(null)
const loading = ref(false)

const handleLogin = async () => {
  loading.value = true
  error.value = null
  try {
    await signInWithEmailAndPassword(auth, email.value, password.value)
    router.push('/dashboard')
  } catch (err) {
    console.error(err)
    error.value = "Correo o contraseña incorrectos."
  } finally {
    loading.value = false
  }
}

const handleGoogleLogin = async () => {
  loading.value = true
  error.value = null
  const provider = new GoogleAuthProvider()
  try {
    const result = await signInWithPopup(auth, provider)
    const user = result.user

    const userDoc = await getDoc(doc(db, 'users', user.uid))
    
    if (!userDoc.exists()) {
      await setDoc(doc(db, 'users', user.uid), {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        role: 'player',
        createdAt: new Date()
      })
    }
    
    router.push('/dashboard')
  } catch (err) {
    console.error(err)
    error.value = "Error al iniciar sesión con Google."
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <div class="glass-card w-full max-w-md">
      <div class="text-center mb-8">
        <img src="/logo.png" alt="Masturbanda League Cup" class="w-32 h-auto mx-auto mb-4 object-contain drop-shadow-lg filter hover:brightness-110 transition-all">
        <h1 class="text-4xl font-black gradient-text leading-tight">Masturbanda<br>League Cup</h1>
        <p class="text-white/60 mt-2">Inicia sesión para entrar al torneo</p>
      </div>

      <form @submit.prevent="handleLogin" class="space-y-6">
        <div v-if="error" class="bg-red-500/10 border border-red-500/50 text-red-500 p-3 rounded-xl text-sm text-center">
          {{ error }}
        </div>

        <div>
          <label class="block text-sm font-medium text-white/80 mb-2">Correo Electrónico</label>
          <input 
            v-model="email"
            type="email" 
            required
            class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-primary/50 transition-all"
            placeholder="tu@correo.com"
          >
        </div>

        <div>
          <label class="block text-sm font-medium text-white/80 mb-2">Contraseña</label>
          <input 
            v-model="password"
            type="password" 
            required
            class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-primary/50 transition-all"
            placeholder="••••••••"
          >
        </div>

        <button type="submit" :disabled="loading" class="btn-primary w-full mt-4 disabled:opacity-50">
          {{ loading ? 'Entrando...' : 'Entrar' }}
        </button>
      </form>

      <div class="relative my-8">
        <div class="absolute inset-0 flex items-center">
          <div class="w-full border-t border-white/10"></div>
        </div>
        <div class="relative flex justify-center text-sm">
          <span class="px-2 bg-secondary text-white/40">O continúa con</span>
        </div>
      </div>

      <button 
        @click="handleGoogleLogin"
        :disabled="loading"
        class="w-full flex items-center justify-center space-x-3 bg-white/5 border border-white/10 rounded-xl py-3 hover:bg-white/10 transition-all disabled:opacity-50"
      >
        <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" class="w-5 h-5" alt="Google">
        <span class="font-bold">Google</span>
      </button>

      <div class="mt-8 text-center text-sm text-white/40">
        ¿No tienes cuenta? <router-link to="/register" class="text-primary hover:underline">Regístrate aquí</router-link>
      </div>
    </div>
  </div>
</template>
