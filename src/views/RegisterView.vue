<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { auth, db } from '../firebase'
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth'
import { doc, setDoc } from 'firebase/firestore'

const router = useRouter()
const email = ref('')
const password = ref('')
const displayName = ref('')
const adminCode = ref('')
const error = ref(null)
const loading = ref(false)

const handleRegister = async () => {
  loading.value = true
  error.value = null
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email.value, password.value)
    const user = userCredential.user

    await updateProfile(user, { displayName: displayName.value })

    // Check for secret admin code (Accepts MLC2026 or MLC26)
    const role = (adminCode.value === 'MLC2026' || adminCode.value === 'MLC26') ? 'admin' : 'player'

    // Create user document in Firestore
    await setDoc(doc(db, 'users', user.uid), {
      uid: user.uid,
      email: user.email,
      displayName: displayName.value,
      role: role,
      createdAt: new Date()
    })

    router.push('/dashboard')
  } catch (err) {
    console.error(err)
    error.value = "Error al registrarse. Verifica tus datos."
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4 relative">
    <!-- Botón Volver -->
    <router-link 
      to="/" 
      class="absolute top-8 left-8 flex items-center space-x-2 text-white/60 hover:text-primary transition-colors group"
    >
      <span class="text-xl group-hover:-translate-x-1 transition-transform">←</span>
      <span class="font-bold uppercase tracking-wider text-sm">Volver</span>
    </router-link>

    <div class="glass-card w-full max-w-md">
      <div class="text-center mb-8">
        <h2 class="text-sm font-bold text-primary uppercase tracking-widest mb-2">Masturbanda League Cup</h2>
        <h1 class="text-4xl font-black gradient-text">Únete</h1>
        <p class="text-white/60 mt-2">Crea tu cuenta para el torneo</p>
      </div>

      <form @submit.prevent="handleRegister" class="space-y-6">
        <div v-if="error" class="bg-red-500/10 border border-red-500/50 text-red-500 p-3 rounded-xl text-sm text-center">
          {{ error }}
        </div>

        <div>
          <label class="block text-sm font-medium text-white/80 mb-2">Nombre Completo</label>
          <input 
            v-model="displayName"
            type="text" 
            required
            class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-primary/50 transition-all"
            placeholder="Tu nombre"
          >
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

        <div>
          <label class="block text-sm font-medium text-white/80 mb-2">Código de Administrador (Opcional)</label>
          <input 
            v-model="adminCode"
            type="password" 
            class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-primary/50 transition-all"
            placeholder="Solo si eres admin"
          >
        </div>

        <button type="submit" :disabled="loading" class="btn-primary w-full mt-4 disabled:opacity-50">
          {{ loading ? 'Registrando...' : 'Crear Cuenta' }}
        </button>
      </form>

      <div class="mt-8 text-center text-sm text-white/40">
        ¿Ya tienes cuenta? <router-link to="/" class="text-primary hover:underline">Inicia sesión</router-link>
      </div>
    </div>
  </div>
</template>
