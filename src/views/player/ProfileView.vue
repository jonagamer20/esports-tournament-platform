<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { auth, db, storage } from '../../firebase'
import { doc, onSnapshot, updateDoc, collection, query, where, getDocs } from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { updateProfile as updateAuthProfile } from 'firebase/auth'

const userData = ref({ displayName: '', email: '', team: '', role: '', photoURL: '' })
const loading = ref(true)
const saving = ref(false)
const uploading = ref(false)
const error = ref(null)
const fileInput = ref(null)
let unsubscribe = null

onMounted(() => {
  const user = auth.currentUser
  if (user) {
    unsubscribe = onSnapshot(doc(db, 'users', user.uid), (doc) => {
      if (doc.exists()) {
        userData.value = { ...userData.value, ...doc.data() }
        // Ensure photoURL is fallbacking to auth photoURL if not in doc
        if (!userData.value.photoURL && user.photoURL) {
            userData.value.photoURL = user.photoURL
        }
      }
      loading.value = false
    })
  } else {
    loading.value = false
  }
})

const triggerFileInput = () => {
  fileInput.value.click()
}

const handlePhotoUpload = async (event) => {
  const file = event.target.files[0]
  if (!file) return

  // Basic validation
  if (!file.type.startsWith('image/')) {
    error.value = "Por favor selecciona una imagen válida."
    return
  }

  if (file.size > 2 * 1024 * 1024) { // 2MB limit
    error.value = "La imagen es demasiado grande (máximo 2MB)."
    return
  }

  uploading.value = true
  error.value = null
  
  try {
    const user = auth.currentUser
    const path = `profiles/${user.uid}/${Date.now()}_${file.name}`
    const fileRef = storageRef(storage, path)
    
    await uploadBytes(fileRef, file)
    const url = await getDownloadURL(fileRef)
    
    // Update both Firestore and Auth Profile
    await updateDoc(doc(db, 'users', user.uid), {
      photoURL: url
    })
    
    await updateAuthProfile(user, {
      photoURL: url
    })

    userData.value.photoURL = url
  } catch (err) {
    console.error(err)
    error.value = "Error al subir la imagen."
  } finally {
    uploading.value = false
  }
}

const updateProfile = async () => {
  saving.value = true
  error.value = null
  try {
    const user = auth.currentUser
    
    await updateDoc(doc(db, 'users', user.uid), {
      displayName: userData.value.displayName
    })

    await updateAuthProfile(user, {
      displayName: userData.value.displayName
    })

    alert('Perfil actualizado con éxito')
  } catch (err) {
    console.error(err)
    error.value = "Error al actualizar el perfil."
  } finally {
    saving.value = false
  }
}

onUnmounted(() => {
  if (unsubscribe) unsubscribe()
})
</script>

<template>
  <main class="p-4 md:p-8">
    <header class="mb-8 md:mb-12">
      <h1 class="text-2xl md:text-4xl font-black gradient-text">Mi Perfil</h1>
      <p class="text-white/40 mt-1 text-sm md:text-base">Gestiona tu información personal</p>
    </header>

    <div v-if="loading" class="text-center p-12 text-white/40">Cargando...</div>

    <div v-else class="glass-card max-w-2xl">
      <div v-if="error" class="mb-6 p-4 bg-red-500/10 border border-red-500/50 text-red-500 rounded-xl text-sm text-center animate-fade">
        {{ error }}
      </div>

      <form @submit.prevent="updateProfile" class="space-y-6">
        <div class="flex flex-col md:flex-row items-center md:items-start space-y-4 md:space-y-0 md:space-x-6 mb-8 text-center md:text-left">
          <div class="relative group">
            <div 
              @click="triggerFileInput"
              class="w-24 h-24 md:w-32 md:h-32 rounded-3xl bg-primary/10 border-2 border-dashed border-primary/30 flex items-center justify-center text-3xl md:text-5xl overflow-hidden cursor-pointer hover:border-primary/60 transition-all relative"
            >
              <img v-if="userData.photoURL" :src="userData.photoURL" alt="Profile" class="w-full h-full object-cover">
              <span v-else>👤</span>
              
              <div class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                <span class="text-xs font-black text-white uppercase tracking-wider text-center px-2">Cambiar Foto</span>
              </div>
              
              <div v-if="uploading" class="absolute inset-0 bg-black/80 flex items-center justify-center">
                <div class="w-6 h-6 border-2 border-primary border-t-transparent animate-spin rounded-full"></div>
              </div>
            </div>
            <input 
              ref="fileInput"
              type="file" 
              accept="image/*" 
              class="hidden" 
              @change="handlePhotoUpload"
            >
          </div>
          
          <div class="flex-1 pt-2">
            <h3 class="text-xl md:text-2xl font-bold">{{ userData.displayName }}</h3>
            <p class="text-white/40 text-sm md:text-base mb-2">{{ userData.email }}</p>
            <div class="flex flex-wrap justify-center md:justify-start gap-2">
              <span class="px-3 py-1 bg-primary/10 text-primary text-[10px] font-black rounded-lg border border-primary/20 uppercase tracking-widest">
                {{ userData.role }}
              </span>
              <span v-if="userData.team" class="px-3 py-1 bg-white/5 text-white/60 text-[10px] font-black rounded-lg border border-white/10 uppercase tracking-widest">
                ⚽ {{ userData.team }}
              </span>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-white/5">
          <div>
            <label class="block text-[10px] font-black text-white/40 uppercase tracking-widest mb-2">Nombre en el Torneo</label>
            <input v-model="userData.displayName" type="text" class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-primary/50 outline-none transition-all placeholder:text-white/10" placeholder="Tu nombre">
          </div>
          <div>
            <div class="flex justify-between items-center mb-2">
              <label class="block text-[10px] font-black text-white/40 uppercase tracking-widest">Equipo del Torneo</label>
              <span v-if="userData.team" class="text-[8px] font-black bg-primary/10 text-primary px-2 py-0.5 rounded border border-primary/20 uppercase tracking-widest line-clamp-1">⚽ Asignado</span>
              <span v-else class="text-[8px] font-black bg-white/5 text-white/30 px-2 py-0.5 rounded border border-white/10 uppercase tracking-widest line-clamp-1">⏳ Pendiente de Sorteo</span>
            </div>
            
            <div class="relative group">
              <div 
                class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white/50 cursor-not-allowed flex items-center justify-between"
              >
                <span>{{ userData.team || 'Esperando sorteo FIFA...' }}</span>
                <span v-if="userData.team">🔒</span>
                <span v-else class="text-white/20">🎲</span>
              </div>
            </div>
            <p v-if="!userData.team" class="mt-1 text-[9px] text-white/20 italic">Tu equipo será asignado por el admin en el sorteo inicial.</p>
            <p v-else class="mt-1 text-[9px] text-primary/40 italic">Este es tu equipo oficial para la Masturbanda League Cup.</p>
          </div>
        </div>

        <button type="submit" :disabled="saving || uploading" class="btn-primary w-full md:w-auto px-12 py-4 text-sm font-black uppercase tracking-widest">
          {{ saving ? 'Guardando...' : 'Guardar Cambios' }}
        </button>
      </form>
    </div>
  </main>
</template>

<style scoped>
@reference "../../style.css";

.btn-primary {
  @apply bg-primary text-secondary rounded-xl hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg shadow-primary/20 disabled:opacity-50 disabled:scale-100;
}

.animate-fade {
  animation: fadeIn 0.3s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>

