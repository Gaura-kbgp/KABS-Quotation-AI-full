"use client";

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { createSession } from '../actions';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, ShieldAlert } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

export function LoginForm() {
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  async function onSubmit(values: z.infer<typeof loginSchema>) {
    setIsLoading(true);
    
    try {
      // Hardcoded credentials check as requested
      if (values.email === 'admin@kabs.com' && values.password === 'admin123') {
        await createSession('kabs_fixed_admin_session_token');
        
        toast({
          title: 'Access Granted',
          description: 'Welcome back, Administrator.',
        });
        
        router.push('/admin/dashboard');
        return;
      }

      throw new Error("Invalid credentials. Please use the authorized administrator account.");
    } catch (error: any) {
      console.error('Login Error:', error);
      
      toast({
        variant: 'destructive',
        title: 'Authentication Failed',
        description: error.message,
      });
      setIsLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-md glass-card border-slate-200">
      <CardHeader className="space-y-1 text-center">
        <div className="mx-auto bg-sky-50 p-3 rounded-full w-fit mb-4">
          <ShieldAlert className="w-8 h-8 text-sky-600" />
        </div>
        <CardTitle className="text-2xl font-bold text-slate-900">Admin Portal</CardTitle>
        <CardDescription className="text-slate-500">Authorized Personnel Only</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-slate-700">Email</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="admin@kabs.com" 
                      {...field} 
                      className="bg-white border-slate-200"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-slate-700">Password</FormLabel>
                  <FormControl>
                    <Input 
                      type="password" 
                      placeholder="••••••••" 
                      {...field} 
                      className="bg-white border-slate-200"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button 
              type="submit" 
              className="w-full gradient-button h-11" 
              disabled={isLoading}
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Sign In
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
