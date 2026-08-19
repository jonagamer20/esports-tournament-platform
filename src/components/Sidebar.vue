<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { auth, db } from '../firebase'
import { doc, getDoc } from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'

const router = useRouter()
const route = useRoute()
const userRole = ref('player')
const isOpen = ref(false)

const toggleSidebar = () => {
  isOpen.value = !isOpen.value
}

const closeSidebar = () => {
  isOpen.value = false
}

const menuItems = [
  { name: 'Dashboard', icon: '🏠', path: '/dashboard' },
  { name: 'Perfil', icon: '👤', path: '/profile' },
  { name: 'Mis Partidos', icon: '🤝', path: '/matches' },
  { name: 'Torneo', icon: '🏆', path: '/tournament' },
  { name: 'Encuentro Final', icon: '⚽', path: '/admin/playoffs' },
  { name: 'Calendario', icon: '📅', path: '/calendar' },
]

const displayedMenuItems = computed(() => {
  if (userRole.value === 'admin') {
    return menuItems.filter(item => ['Dashboard', 'Perfil', 'Calendario'].includes(item.name))
  }
  return menuItems
})

const adminItems = [
  { name: 'Jugadores', icon: '👥', path: '/admin/players' },
  { name: 'Sorteo', icon: '🎲', path: '/admin/tournament' },
  { name: 'Gestión Grupos', icon: '📝', path: '/admin/groups' },
  { name: 'Encuentro Final', icon: '🏆', path: '/admin/playoffs' },
  { name: 'Monitoreo Partidos', icon: '📡', path: '/admin/matches' },
]

const currentUser = ref(null)

onMounted(() => {
  onAuthStateChanged(auth, async (user) => {
    currentUser.value = user
    if (user) {
      const userDoc = await getDoc(doc(db, 'users', user.uid))
      if (userDoc.exists()) {
        userRole.value = userDoc.data().role || 'player'
        // If firestore has a different photoURL/displayName, we might want to prioritize it
        if (userDoc.data().photoURL) {
            currentUser.value = { ...user, photoURL: userDoc.data().photoURL, displayName: userDoc.data().displayName || user.displayName }
        }
      }
    }
  })
})

const logout = () => {
  auth.signOut()
  router.push('/')
}
</script>

<template>
  <!-- Mobile Hamburger Button -->
  <button 
    @click="toggleSidebar"
    class="md:hidden fixed top-4 left-4 z-50 p-2 bg-secondary/80 backdrop-blur-md border border-white/10 rounded-lg text-white shadow-lg"
  >
    <span class="text-xl">☰</span>
  </button>

  <!-- Overlay for Mobile -->
  <div 
    v-if="isOpen" 
    @click="closeSidebar"
    class="md:hidden fixed inset-0 bg-black/80 z-40 backdrop-blur-sm transition-opacity"
  ></div>

  <!-- Sidebar -->
  <aside 
    class="fixed inset-y-0 left-0 z-50 w-64 bg-secondary/95 backdrop-blur-xl border-r border-white/10 flex flex-col h-screen transition-transform duration-300 md:translate-x-0 md:sticky md:top-0 md:bg-secondary/50"
    :class="isOpen ? 'translate-x-0' : '-translate-x-full'"
  >
    <div class="p-6 pt-16 md:pt-6 flex flex-col items-center text-center space-y-3">
      <img src="/logo.png" alt="Masturbanda League Cup" class="w-16 h-auto object-contain drop-shadow-lg filter hover:brightness-110 transition-all">
      <h2 class="text-lg font-black gradient-text leading-tight">Masturbanda<br>League Cup</h2>
    </div>

    <!-- User Profile Section -->
    <div v-if="currentUser" class="px-4 mb-4">
      <div class="bg-white/5 border border-white/10 rounded-2xl p-4 flex items-center space-x-3">
        <div class="w-10 h-10 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center overflow-hidden shrink-0">
          <img v-if="currentUser.photoURL" :src="currentUser.photoURL" class="w-full h-full object-cover">
          <span v-else class="text-lg">👤</span>
        </div>
        <div class="flex-1 min-w-0 text-left">
          <p class="text-sm font-bold text-white truncate">{{ currentUser.displayName || 'Usuario' }}</p>
          <p class="text-[10px] text-primary font-black uppercase tracking-widest">{{ userRole }}</p>
        </div>
      </div>
    </div>

    <nav class="flex-1 px-4 space-y-2 mt-4 overflow-y-auto">
      <div class="text-xs font-bold text-white/20 uppercase tracking-widest px-4 mb-2">Menú</div>
      <router-link 
        v-for="item in displayedMenuItems" 
        :key="item.name"
        :to="item.path"
        @click="closeSidebar"
        class="flex items-center space-x-3 px-4 py-3 rounded-xl transition-all duration-200 group"
        :class="route.path === item.path ? 'bg-primary text-secondary font-bold' : 'text-white/60 hover:bg-white/5 hover:text-white'"
      >
        <span class="text-xl">{{ item.icon }}</span>
        <span>{{ item.name }}</span>
      </router-link>

      <div v-if="userRole === 'admin'" class="mt-8">
        <div class="text-xs font-bold text-white/20 uppercase tracking-widest px-4 mb-2">Administración</div>
        <router-link 
          v-for="item in adminItems" 
          :key="item.name"
          :to="item.path"
          @click="closeSidebar"
          class="flex items-center space-x-3 px-4 py-3 rounded-xl transition-all duration-200 group"
          :class="route.path === item.path ? 'bg-primary text-secondary font-bold' : 'text-white/60 hover:bg-white/5 hover:text-white'"
        >
          <span class="text-xl">{{ item.icon }}</span>
          <span>{{ item.name }}</span>
        </router-link>
      </div>
    </nav>

    <div class="p-4 border-t border-white/10">
      <button 
        @click="logout"
        class="w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-red-400 hover:bg-red-400/10 transition-all"
      >
        <span>🚪</span>
        <span>Cerrar Sesión</span>
      </button>
    </div>
  </aside>
</template>
