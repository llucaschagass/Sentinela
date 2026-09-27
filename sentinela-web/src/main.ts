import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { AppComponent, DashboardComponent, DetailComponent } from './ui';
bootstrapApplication(AppComponent,{providers:[provideHttpClient(),provideRouter([
  {path:'',component:DashboardComponent},{path:'issues/:id',component:DetailComponent},{path:'**',redirectTo:''}
])]}).catch(()=>console.error('Falha ao iniciar interface'));
