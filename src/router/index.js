import { createRouter, createWebHistory } from 'vue-router'
import LoginView from '../views/LoginView.vue'
import RegisterView from '../views/RegisterView.vue'
import DashboardView from '../views/DashboardView.vue'
import AdminPlayersView from '../views/admin/AdminPlayersView.vue'
import AdminTournamentView from '../views/admin/AdminTournamentView.vue'
import AdminGroupsView from '../views/admin/AdminGroupsView.vue'
import TournamentView from '../views/player/TournamentView.vue'
import ProfileView from '../views/player/ProfileView.vue'
import CalendarView from '../views/player/CalendarView.vue'
import MatchesView from '../views/player/MatchesView.vue'
import AdminMatchesView from '../views/admin/AdminMatchesView.vue'
import AdminPlayoffsView from '../views/admin/AdminPlayoffsView.vue'

const routes = [
    {
        path: '/',
        name: 'login',
        component: LoginView
    },
    {
        path: '/register',
        name: 'register',
        component: RegisterView
    },
    {
        path: '/dashboard',
        name: 'dashboard',
        component: DashboardView
    },
    {
        path: '/matches',
        name: 'matches',
        component: MatchesView
    },
    {
        path: '/admin/players',
        name: 'admin-players',
        component: AdminPlayersView
    },
    {
        path: '/admin/tournament',
        name: 'admin-tournament',
        component: AdminTournamentView
    },
    {
        path: '/admin/playoffs',
        name: 'admin-playoffs',
        component: AdminPlayoffsView
    },
    {
        path: '/admin/groups',
        name: 'admin-groups',
        component: AdminGroupsView
    },
    {
        path: '/admin/matches',
        name: 'admin-matches',
        component: AdminMatchesView
    },
    {
        path: '/tournament',
        name: 'tournament',
        component: TournamentView
    },
    {
        path: '/profile',
        name: 'profile',
        component: ProfileView
    },
    {
        path: '/calendar',
        name: 'calendar',
        component: CalendarView
    }
]

const router = createRouter({
    history: createWebHistory(),
    routes
})

export default router
