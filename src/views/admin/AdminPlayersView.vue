<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { db } from '../../firebase'
import { collection, onSnapshot, doc, deleteDoc, updateDoc, writeBatch, getDocs } from 'firebase/firestore'

const players = ref([])
const loading = ref(true)
let unsubscribe = null

onMounted(() => {
  const q = collection(db, 'users')
  unsubscribe = onSnapshot(q, (querySnapshot) => {
    const allUsers = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
    
    // Sort logic: 
    // 1. Admins first
    // 2. Then by level (1, 2, etc.)
    // 3. Then by name
    allUsers.sort((a, b) => {
      // Admin priority
      if (a.role === 'admin' && b.role !== 'admin') return -1
      if (a.role !== 'admin' && b.role === 'admin') return 1
      
      // Level priority (for players)
      if (a.role === 'player' && b.role === 'player') {
        const levelA = a.level || 2
        const levelB = b.level || 2
        if (levelA !== levelB) return levelA - levelB
      }
      
      // Name priority
      return a.displayName.localeCompare(b.displayName)
    })

    players.value = allUsers
    loading.value = false
  }, (error) => {
    console.error("Error listening to players:", error)
    loading.value = false
  })
})

const deletePlayer = async (id) => {
  if (confirm('¿Estás seguro de eliminar a este jugador?')) {
    try {
      await deleteDoc(doc(db, 'users', id))
    } catch (error) {
      console.error("Error deleting player:", error)
    }
  }
}

const updateLevel = async (id, level) => {
  try {
    await updateDoc(doc(db, 'users', id), {
      level: parseInt(level)
    })
  } catch (error) {
    console.error("Error updating level:", error)
  }
}

const resetTournament = async () => {
  if (!confirm('⚠️ ¿ESTÁS SEGURO? ⚠️\n\nEsta acción ELIMINARÁ TODO:\n- Todos los partidos y resultados\n- Todos los grupos y puntos\n- El historial del chat\n\nLos jugadores volverán a estado inicial para un nuevo sorteo.\n\nNO SE PUEDE DESHACER.')) {
    return
  }

  loading.value = true
  try {
    const batch = writeBatch(db)

    // 1. Delete all matches
    const matchesSnapshot = await getDocs(collection(db, 'matches'))
    matchesSnapshot.forEach(doc => {
      batch.delete(doc.ref)
    })

    // 2. Delete all messages
    const messagesSnapshot = await getDocs(collection(db, 'messages'))
    messagesSnapshot.forEach(doc => {
      batch.delete(doc.ref)
    })

    // 3. Reset all users
    const usersSnapshot = await getDocs(collection(db, 'users'))
    usersSnapshot.forEach(userDoc => {
      const userData = userDoc.data()
      // Keep admin role and profile info, reset tournament data
      batch.update(userDoc.ref, {
        group: null,
        points: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        matchesPlayed: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        pot: null, // Reset pot assignment if any
        // Optional: Reset team if you want them to pick again
        // team: null 
      })
    })

    await batch.commit()
    
    alert('✅ Torneo reiniciado correctamente. Todo está limpio para empezar de nuevo.')
  } catch (error) {
    console.error('Error resetting tournament:', error)
    alert('Error al reiniciar el torneo')
  } finally {
    loading.value = false
  }
}

onUnmounted(() => {
  if (unsubscribe) unsubscribe()
})
</script>

<template>
  <main class="p-4 md:p-8">
    <header class="mb-8 md:mb-12">
      <h1 class="text-2xl md:text-4xl font-black gradient-text">Gestión de Jugadores</h1>
      <p class="text-white/40 mt-1 text-sm md:text-base">Administra los participantes y asigna niveles para el sorteo</p>
    </header>

    <div class="glass-card overflow-hidden">
      <div v-if="loading" class="p-8 text-center text-white/40">
        Cargando jugadores...
      </div>
      
      <div v-else>
        <!-- Desktop Table -->
        <div class="hidden md:block overflow-x-auto">
          <table class="w-full text-left">
          <thead>
            <tr class="border-b border-white/10 text-white/60 text-xs md:text-sm uppercase tracking-wider">
              <th class="px-4 py-3 md:px-6 md:py-4">Jugador</th>
              <th class="px-4 py-3 md:px-6 md:py-4">Correo</th>
              <th class="px-4 py-3 md:px-6 md:py-4 text-center">Nivel (Bombo)</th>
              <th class="px-4 py-3 md:px-6 md:py-4">Rol</th>
              <th class="px-4 py-3 md:px-6 md:py-4">Acciones</th>
            </tr>
          </thead>
        <tbody class="divide-y divide-white/5">
          <tr v-for="player in players" :key="player.id" class="hover:bg-white/5 transition-colors">
            <td class="px-6 py-4 flex items-center space-x-3">
              <div class="w-8 h-8 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center overflow-hidden shrink-0">
                <img v-if="player.photoURL" :src="player.photoURL" class="w-full h-full object-cover">
                <span v-else class="text-sm font-black">👤</span>
              </div>
              <span class="font-bold text-primary">{{ player.displayName }}</span>
            </td>
            <td class="px-6 py-4 text-white/60">{{ player.email }}</td>
            <td class="px-6 py-4 text-center">
              <select 
                v-if="player.role === 'player'"
                @change="updateLevel(player.id, $event.target.value)"
                class="bg-white/10 border border-white/20 rounded-lg px-3 py-1.5 text-sm text-white focus:border-primary outline-none cursor-pointer hover:bg-white/20 transition-all appearance-none"
                style="background-image: url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23FFD700%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E'); background-repeat: no-repeat; background-position: right 0.7rem top 50%; background-size: 0.65rem auto; padding-right: 2rem;"
              >
                <option value="1" :selected="player.level === 1" class="bg-secondary text-white">Nivel 1 (Top)</option>
                <option value="2" :selected="player.level === 2 || !player.level" class="bg-secondary text-white">Nivel 2 (Regular)</option>
              </select>
              <span v-else class="text-white/20">-</span>
            </td>
            <td class="px-6 py-4">
              <span class="px-3 py-1 rounded-full text-xs border border-white/20" 
                    :class="player.role === 'admin' ? 'bg-primary/20 text-primary border-primary/50' : 'bg-white/5 text-white/60'">
                {{ player.role }}
              </span>
            </td>
            <td class="px-6 py-4 space-x-3">
              <button @click="deletePlayer(player.id)" class="text-red-400 hover:underline text-sm">Eliminar</button>
            </td>
          </tr>
        </tbody>
        </table>
        </div>

        <!-- Mobile Cards -->
        <div class="md:hidden space-y-4 p-4">
          <div v-for="player in players" :key="player.id" class="bg-white/5 rounded-xl p-4 border border-white/10">
            <div class="flex justify-between items-start mb-3">
              <div>
                <h3 class="font-bold text-primary text-lg">{{ player.displayName }}</h3>
                <p class="text-white/40 text-xs">{{ player.email }}</p>
              </div>
              <span class="px-2 py-1 rounded-full text-[10px] border border-white/20" 
                    :class="player.role === 'admin' ? 'bg-primary/20 text-primary border-primary/50' : 'bg-white/5 text-white/60'">
                {{ player.role }}
              </span>
            </div>
            
            <div class="flex items-center justify-between pt-3 border-t border-white/5">
              <div class="flex items-center space-x-2">
                <span class="text-xs text-white/40 uppercase font-bold">Nivel:</span>
                <select 
                  v-if="player.role === 'player'"
                  @change="updateLevel(player.id, $event.target.value)"
                  class="bg-white/10 border border-white/20 rounded px-2 py-1 text-xs text-white focus:border-primary outline-none"
                >
                  <option value="1" :selected="player.level === 1" class="bg-secondary text-white">Nivel 1</option>
                  <option value="2" :selected="player.level === 2 || !player.level" class="bg-secondary text-white">Nivel 2</option>
                </select>
                <span v-else class="text-white/20 text-xs">-</span>
              </div>
              
              <button @click="deletePlayer(player.id)" class="text-red-400 hover:text-red-300 text-xs font-bold uppercase">
                Eliminar
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Danger Zone -->
    <section class="mt-24 border-t border-red-500/20 pt-12">
      <div class="bg-red-500/5 border border-red-500/20 rounded-2xl p-8 flex flex-col md:flex-row items-center justify-between gap-6">
        <div>
          <h3 class="text-xl font-black text-red-500 flex items-center gap-2">
            <span>⚠️</span> ZONA DE PELIGRO
          </h3>
          <p class="text-red-200/60 mt-2 max-w-xl">
            Aquí puedes eliminar todos los datos del torneo actual (partidos, grupos, puntos, chat) para comenzar una nueva edición desde cero. Los usuarios registrados se mantendrán, pero perderán su progreso.
          </p>
        </div>
        <button 
          @click="resetTournament" 
          :disabled="loading"
          class="px-6 py-4 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white font-black uppercase tracking-widest rounded-xl border border-red-500 transition-all disabled:opacity-50 whitespace-nowrap"
        >
          {{ loading ? 'Eliminando...' : '☢️ ELIMINAR TODO Y REINICIAR' }}
        </button>
      </div>
    </section>
  </main>
</template>
