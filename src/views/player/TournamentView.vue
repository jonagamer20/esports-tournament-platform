<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { db, auth } from '../../firebase'
import { collection, onSnapshot } from 'firebase/firestore'

const groups = ref({ A: [], B: [], C: [], D: [] })
const userGroup = ref(null)
const loading = ref(true)
let unsubscribe = null

onMounted(() => {
  const q = collection(db, 'users')
  unsubscribe = onSnapshot(q, (querySnapshot) => {
    const players = querySnapshot.docs.filter(d => d.data().role === 'player').map(doc => ({ id: doc.id, ...doc.data() }))
    
    // Sort players by points, then goal difference, then goals for
    players.sort((a, b) => {
      if ((b.points || 0) !== (a.points || 0)) return (b.points || 0) - (a.points || 0)
      const gdA = (a.goalsFor || 0) - (a.goalsAgainst || 0)
      const gdB = (b.goalsFor || 0) - (b.goalsAgainst || 0)
      if (gdB !== gdA) return gdB - gdA
      return (b.goalsFor || 0) - (a.goalsFor || 0)
    })

    // Organize into groups
    const tempGroups = { A: [], B: [], C: [], D: [] }
    players.forEach(p => {
      if (p.group && tempGroups[p.group]) {
        tempGroups[p.group].push(p)
      }
    })
    groups.value = tempGroups

    // Find current user's group
    const currentUser = auth.currentUser
    if (currentUser) {
      const userDoc = players.find(p => p.id === currentUser.uid)
      if (userDoc) userGroup.value = userDoc.group
    }
    loading.value = false
  }, (error) => {
    console.error("Error listening to tournament data:", error)
    loading.value = false
  })
})

onUnmounted(() => {
  if (unsubscribe) unsubscribe()
})
</script>

<template>
  <main class="p-8">
    <header class="mb-12">
      <h1 class="text-4xl font-black gradient-text">Torneo</h1>
      <p class="text-white/40 mt-1">Fase de Grupos - Masturbanda League Cup</p>
    </header>

    <div v-if="loading" class="text-center p-12 text-white/40">
      Cargando grupos...
    </div>

    <div v-else class="grid grid-cols-1 xl:grid-cols-2 gap-8">
      <div v-for="(players, groupName) in groups" :key="groupName" 
           class="glass-card overflow-hidden"
           :class="userGroup === groupName ? 'border-primary shadow-lg shadow-primary/10' : ''">
        <div class="flex justify-between items-center mb-6 px-2">
          <h3 class="text-2xl font-black">Grupo {{ groupName }}</h3>
          <span v-if="userGroup === groupName" class="text-[10px] bg-primary text-secondary px-2 py-1 rounded font-black tracking-tighter">TU GRUPO</span>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="text-[10px] text-white/20 uppercase font-black border-b border-white/5">
                <th class="pb-3 pl-2">#</th>
                <th class="pb-3">Jugador</th>
                <th class="pb-3 text-center">PJ</th>
                <th class="pb-3 text-center">V</th>
                <th class="pb-3 text-center">E</th>
                <th class="pb-3 text-center">D</th>
                <th class="pb-3 text-center text-primary">DG</th>
                <th class="pb-3 text-center font-black text-white">Pts</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-white/5">
              <tr v-for="(player, index) in players" :key="player.id" 
                  class="group hover:bg-white/[0.02] transition-colors">
                <td class="py-4 pl-2 text-[10px] font-black text-white/20">{{ index + 1 }}</td>
                <td class="py-4">
                  <div class="flex items-center space-x-3">
                    <div class="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center text-[10px] border border-white/10 overflow-hidden">
                      <img v-if="player.photoURL" :src="player.photoURL" class="w-full h-full object-cover">
                      <span v-else>👤</span>
                    </div>
                    <div class="flex flex-col">
                      <span class="font-bold text-sm" :class="player.id === auth.currentUser?.uid ? 'text-primary' : 'text-white'">
                        {{ player.displayName }}
                      </span>
                      <span class="text-[9px] text-primary font-black uppercase italic">{{ player.team }}</span>
                    </div>
                  </div>
                </td>
                <td class="py-4 text-center text-xs font-bold text-white/60">{{ player.playedMatches || 0 }}</td>
                <td class="py-4 text-center text-xs text-white/40">{{ player.wins || 0 }}</td>
                <td class="py-4 text-center text-xs text-white/40">{{ player.draws || 0 }}</td>
                <td class="py-4 text-center text-xs text-white/40">{{ player.losses || 0 }}</td>
                <td class="py-4 text-center text-xs font-black" :class="(player.goalsFor || 0) - (player.goalsAgainst || 0) >= 0 ? 'text-green-400' : 'text-red-400'">
                  {{ (player.goalsFor || 0) - (player.goalsAgainst || 0) > 0 ? '+' : '' }}{{ (player.goalsFor || 0) - (player.goalsAgainst || 0) }}
                </td>
                <td class="py-4 text-center font-black text-white">{{ player.points || 0 }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </main>
</template>
