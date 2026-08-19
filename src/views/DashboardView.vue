<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { auth, db } from '../firebase'
import { doc, onSnapshot, collection, query, where, orderBy, limit } from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'
import ImageStackCarousel from '../components/ImageStackCarousel.vue'

const userData = ref(null)

const recentMatches = ref([])
const nextMatch = ref(null)
const userRank = ref(null)
const topScorers = ref([])
const loading = ref(true)
let unsubscribeUser = null
let unsubscribeNextMatch = null
let unsubscribeMatches = null
let unsubscribeMessages = null
let unsubscribeRank = null
let unsubscribeScorers = null

const formatTimeAgo = (date) => {
  if (!date) return 'Hace un momento'
  // Handle Firestore Timestamp or standard Date
  const jsDate = date.toDate ? date.toDate() : new Date(date)
  const seconds = Math.floor((new Date() - jsDate) / 1000)
  
  let interval = seconds / 31536000
  if (interval > 1) return Math.floor(interval) + " años"
  interval = seconds / 2592000
  if (interval > 1) return Math.floor(interval) + " meses"
  interval = seconds / 86400
  if (interval > 1) return Math.floor(interval) + " días"
  interval = seconds / 3600
  if (interval > 1) return Math.floor(interval) + " h"
  interval = seconds / 60
  if (interval > 1) return Math.floor(interval) + " min"
  return "Hace un momento"
}

onMounted(() => {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      // Real-time listener for user data
      unsubscribeUser = onSnapshot(doc(db, 'users', user.uid), (doc) => {
        if (doc.exists()) {
          userData.value = doc.data()
          
          // Fetch User Rank once we have the group
          if (userData.value?.group) {
            if (unsubscribeRank) unsubscribeRank() // Clear previous listener if any
            
            const qRank = query(
              collection(db, 'users'),
              where('group', '==', userData.value.group)
            )
            
            unsubscribeRank = onSnapshot(qRank, (snapshot) => {
              const groupUsers = snapshot.docs.map(doc => doc.data())
              // Sort: Points > Goal Diff > Goals For
              groupUsers.sort((a, b) => {
                const pointsA = Number(a.points) || 0
                const pointsB = Number(b.points) || 0
                if (pointsB !== pointsA) return pointsB - pointsA
                
                const diffA = (Number(a.goalsFor) || 0) - (Number(a.goalsAgainst) || 0)
                const diffB = (Number(b.goalsFor) || 0) - (Number(b.goalsAgainst) || 0)
                if (diffB !== diffA) return diffB - diffA
                
                return (Number(b.goalsFor) || 0) - (Number(a.goalsFor) || 0)
              })
              
              const rank = groupUsers.findIndex(u => u.uid === user.uid) + 1
              userRank.value = rank
            })
          }
        }
        loading.value = false
      })

      // Fetch Next Match (Any pending match for the user, ordered by Fecha)
      const qNext = query(
        collection(db, 'matches'),
        orderBy('fecha', 'asc')
      )
      
      // We need to filter client-side for user participation since Firestore OR queries are limited
      unsubscribeNextMatch = onSnapshot(qNext, (snapshot) => {
        const allMatches = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
        
        // Find first match where user plays and is NOT played
        const myNext = allMatches.find(m => 
          (m.homeId === user.uid || m.awayId === user.uid) && 
          m.status !== 'played'
        )
        
        if (myNext) {
          nextMatch.value = {
            opponentName: myNext.homeId === user.uid ? myNext.awayName : myNext.homeName,
            time: myNext.scheduledTime || 'Horario por definir',
            fecha: myNext.fecha,
            isScheduled: !!myNext.scheduledTime
          }
        } else {
          nextMatch.value = null
        }
      })

      // Fetch Top Scorers
      const qScorers = query(
        collection(db, 'users'),
        orderBy('goalsFor', 'desc'),
        limit(5)
      )
      
      unsubscribeScorers = onSnapshot(qScorers, (snapshot) => {
        topScorers.value = snapshot.docs.map(doc => doc.data())
      })

      // Fetch recent matches and messages
      const qMatches = query(
        collection(db, 'matches'),
        where('status', '==', 'played'),
        orderBy('reportedAt', 'desc'),
        limit(10)
      )

      const qMessages = query(
        collection(db, 'messages'),
        orderBy('createdAt', 'desc'),
        limit(5)
      )
      
      // We need to combine two listeners. 
      // Strategy: Store raw data in refs and combine them in a computed or watcher.
      // For simplicity here, we'll use a single update function called by both listeners.
      
      const rawMatches = ref([])
      const rawMessages = ref([])
      
      const updateRecentActivity = () => {
        // Process Matches
        const pairs = []
        const processedKeys = new Set()
        
        rawMatches.value.forEach(m => {
          const players = [m.homeId, m.awayId].sort()
          const pairKey = players.join('_')
          
          if (processedKeys.has(pairKey)) return
          
          const otherMatch = rawMatches.value.find(om => 
            om.id !== m.id && 
            ((om.homeId === m.homeId && om.awayId === m.awayId) || (om.homeId === m.awayId && om.awayId === m.homeId))
          )
          
          const ida = m.type === 'Ida' ? m : otherMatch
          const vuelta = m.type === 'Vuelta' ? m : otherMatch
          
          if (ida && vuelta) {
             pairs.push({
               type: 'duel',
               homeName: ida.homeName,
               awayName: ida.awayName,
               idaScore: `${ida.scoreHome}-${ida.scoreAway}`,
               vueltaScore: `${vuelta.scoreHome}-${vuelta.scoreAway}`,
               reportedAt: m.reportedAt,
               timestamp: m.reportedAt?.toDate ? m.reportedAt.toDate() : new Date(m.reportedAt)
             })
             processedKeys.add(pairKey)
          } else {
            pairs.push({
              type: 'single',
              homeName: m.homeName,
              awayName: m.awayName,
              score: `${m.scoreHome}-${m.scoreAway}`,
              matchType: m.type,
              reportedAt: m.reportedAt,
              timestamp: m.reportedAt?.toDate ? m.reportedAt.toDate() : new Date(m.reportedAt)
            })
          }
        })
        
        // Process Messages
        const msgs = rawMessages.value.map(msg => ({
          type: 'message',
          ...msg,
          timestamp: msg.createdAt?.toDate ? msg.createdAt.toDate() : new Date()
        }))
        
        // Combine and Sort
        const combined = [...pairs, ...msgs].sort((a, b) => b.timestamp - a.timestamp)
        
        recentMatches.value = combined.slice(0, 3) // Show top 3 items
      }
      
      unsubscribeMatches = onSnapshot(qMatches, (snapshot) => {
        rawMatches.value = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
        updateRecentActivity()
      })

      unsubscribeMessages = onSnapshot(qMessages, (snapshot) => {
        rawMessages.value = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
        updateRecentActivity()
      })
    } else {
      loading.value = false
    }
  })
})

onUnmounted(() => {
  if (unsubscribeUser) unsubscribeUser()
  if (unsubscribeNextMatch) unsubscribeNextMatch()
  if (unsubscribeMatches) unsubscribeMatches()
  if (unsubscribeMessages) unsubscribeMessages()
  if (unsubscribeRank) unsubscribeRank()
  if (unsubscribeScorers) unsubscribeScorers()
})
</script>

<template>
  <main class="p-8">
    <div v-if="loading" class="flex items-center justify-center h-[60vh]">
      <p class="text-white/40 animate-pulse">Cargando datos reales...</p>
    </div>

    <template v-else-if="userData">
      <header class="flex justify-between items-center mb-12">
        <div>
          <h1 class="text-4xl font-black gradient-text">Panel de Control</h1>
          <p class="text-white/40 mt-1">Bienvenido de nuevo, {{ userData.displayName }}</p>
        </div>
        
        <div class="flex items-center space-x-4">
          <div class="text-right">
            <p class="font-bold">{{ userData.displayName }}</p>
            <p class="text-xs text-primary uppercase font-black">{{ userData.role }}</p>
          </div>
          <div class="w-12 h-12 rounded-2xl bg-primary/20 border border-primary/50 flex items-center justify-center text-xl overflow-hidden relative">
            <img v-if="userData.photoURL" :src="userData.photoURL" alt="Profile" class="w-full h-full object-cover">
            <span v-else>👤</span>
          </div>
        </div>
      </header>

      <!-- Carousel Section -->
      <section class="mb-12">
        <ImageStackCarousel />
      </section>

      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        <!-- Stats Cards -->
        <div class="glass-card">
          <div class="text-primary text-3xl mb-4">🏆</div>
          <h3 class="text-xl font-bold mb-2">Mi Equipo</h3>
          <p class="text-white/60 mb-4">{{ userData.team || 'Sin equipo asignado' }}</p>
          <div class="h-1 bg-white/10 rounded-full overflow-hidden">
            <div :class="userData.team ? 'w-full' : 'w-0'" class="h-full bg-primary transition-all duration-1000"></div>
          </div>
          <p class="text-xs text-white/40 mt-2">{{ userData.team ? 'Equipo listo' : 'Ve a Perfil para elegir equipo' }}</p>
        </div>

        <div class="glass-card">
          <div class="text-accent text-3xl mb-4">⚽</div>
          <h3 class="text-xl font-bold mb-2">Próximo Partido</h3>
          <div v-if="nextMatch">
            <p class="text-white/60 text-sm">vs <span class="text-white font-bold">{{ nextMatch.opponentName }}</span></p>
            <p class="font-bold text-lg mt-1" :class="nextMatch.isScheduled ? 'text-primary' : 'text-white/40 italic'">
              {{ nextMatch.time }}
            </p>
            <p class="text-[10px] text-white/40 uppercase font-black mt-1">Fecha {{ nextMatch.fecha }}</p>
          </div>
          <div v-else>
            <p class="text-white/60">No hay partidos programados</p>
            <router-link to="/calendar" class="block mt-4 text-sm text-primary font-bold hover:underline">Ver calendario →</router-link>
          </div>
        </div>

        <div class="glass-card">
          <div class="text-green-400 text-3xl mb-4">📊</div>
          <h3 class="text-xl font-bold mb-2">Posición</h3>
          <p class="text-white/60">{{ userData.group ? 'Grupo ' + userData.group : 'Sin grupo' }}</p>
          <div v-if="userRank" class="mt-2">
            <span class="text-4xl font-black text-white">{{ userRank }}º</span>
            <span class="text-sm text-white/40 ml-2">Lugar</span>
          </div>
          <p class="text-xs text-white/40 mt-2">{{ userData.points || 0 }} Puntos acumulados</p>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-12">
        <!-- Top Scorers (Pichichi) -->
        <div class="lg:col-span-1">
          <h2 class="text-2xl font-bold mb-6">🏆 Pichichi</h2>
          <div class="glass-card p-0 overflow-hidden">
            <div v-if="topScorers.length === 0" class="p-8 text-center text-white/40 italic">
              Aún no hay goles registrados.
            </div>
            <div v-else>
              <div v-for="(player, index) in topScorers" :key="player.uid" 
                   class="flex items-center justify-between p-4 border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors">
                <div class="flex items-center space-x-3">
                  <div class="relative">
                    <div class="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center overflow-hidden shrink-0">
                      <img v-if="player.photoURL" :src="player.photoURL" class="w-full h-full object-cover">
                      <span v-else class="text-sm font-black">👤</span>
                    </div>
                    <div class="absolute -top-2 -left-2 w-5 h-5 flex items-center justify-center rounded-full font-black text-[10px] shadow-lg border border-black"
                         :class="index === 0 ? 'bg-yellow-500 text-black' : (index === 1 ? 'bg-gray-400 text-black' : (index === 2 ? 'bg-orange-700 text-white' : 'bg-white/10 text-white/60'))">
                      {{ index + 1 }}
                    </div>
                  </div>
                  <div>
                    <p class="font-bold text-sm">{{ player.displayName }}</p>
                    <p class="text-[10px] text-white/40">{{ player.team || 'Sin equipo' }}</p>
                  </div>
                </div>
                <div class="text-right">
                  <span class="text-xl font-black text-primary">{{ player.goalsFor || 0 }}</span>
                  <span class="text-[10px] text-white/40 block uppercase font-bold">Goles</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Recent Activity -->
        <div class="lg:col-span-2">
          <h2 class="text-2xl font-bold mb-6">Actividad del Torneo</h2>
          <div v-if="recentMatches.length === 0" class="glass-card p-12 text-center">
            <p class="text-white/40 italic">No hay actividad reciente. ¡El torneo está por comenzar!</p>
          </div>
          
          <div v-else class="flex flex-col space-y-4">
            <div v-for="(activity, index) in recentMatches" :key="index" 
                 class="bg-white/10 backdrop-blur-md rounded-2xl p-4 w-full border border-white/10 shadow-lg relative overflow-hidden">
              
              <!-- Message Type -->
              <div v-if="activity.type === 'message'">
                <div class="flex items-center justify-between mb-2">
                  <div class="flex items-center space-x-2">
                    <div class="w-5 h-5 rounded-md bg-green-500 flex items-center justify-center text-[10px] shadow-sm text-black">
                      💬
                    </div>
                    <span class="text-xs font-bold text-white/80 uppercase tracking-wide">Chat Global</span>
                  </div>
                  <span class="text-[10px] text-white/40">{{ formatTimeAgo(activity.createdAt) }}</span>
                </div>
                <div class="pl-7">
                  <div class="flex items-start space-x-2">
                    <div class="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-[10px] shrink-0 border border-white/20 overflow-hidden">
                      <img v-if="activity.photoURL" :src="activity.photoURL" class="w-full h-full object-cover">
                      <span v-else>{{ activity.displayName?.[0]?.toUpperCase() }}</span>
                    </div>
                    <div>
                      <p class="text-xs font-bold text-primary">{{ activity.displayName }}</p>
                      <p class="text-sm text-white/90">{{ activity.text }}</p>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Match Type -->
              <div v-else>
                <!-- Header -->
                <div class="flex items-center justify-between mb-2">
                  <div class="flex items-center space-x-2">
                    <div class="w-5 h-5 rounded-md bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center text-[10px] shadow-sm">
                      ⚽
                    </div>
                    <span class="text-xs font-bold text-white/80 uppercase tracking-wide">Masturbanda League</span>
                  </div>
                  <span class="text-[10px] text-white/40">{{ formatTimeAgo(activity.reportedAt) }}</span>
                </div>
                
                <!-- Body -->
                <div class="pl-7">
                  <p class="text-sm font-bold text-white mb-1">Resultado Final</p>
                  <p class="text-xs text-white/60 mb-2">
                    {{ activity.homeName }} vs {{ activity.awayName }}
                  </p>
                  
                  <!-- Details -->
                  <div v-if="activity.type === 'duel'" class="space-y-1">
                    <div class="grid grid-cols-[50px_1fr_auto_1fr] gap-2 items-center text-xs font-mono text-white/80">
                      <span class="text-white/40 font-bold">IDA</span>
                      <span class="truncate text-right">{{ activity.homeName }}</span>
                      <span class="text-primary font-bold text-center px-2 bg-white/5 rounded">{{ activity.idaScore }}</span>
                      <span class="truncate">{{ activity.awayName }}</span>
                    </div>
                    <div class="grid grid-cols-[50px_1fr_auto_1fr] gap-2 items-center text-xs font-mono text-white/80">
                      <span class="text-white/40 font-bold">VUELTA</span>
                      <span class="truncate text-right">{{ activity.awayName }}</span>
                      <span class="text-primary font-bold text-center px-2 bg-white/5 rounded">{{ activity.vueltaScore ? activity.vueltaScore.split('-').reverse().join('-') : '0-0' }}</span>
                      <span class="truncate">{{ activity.homeName }}</span>
                    </div>
                  </div>
                  <div v-else>
                     <p class="text-xs font-mono text-white/80">
                      <span class="text-white/40 mr-1">{{ activity.matchType }}:</span> 
                      <span class="text-primary font-bold">{{ activity.score }}</span>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </main>
</template>
