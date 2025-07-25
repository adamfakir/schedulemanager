// src/pages/Home.tsx
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import {Box, Heading, Text, Spinner, VStack, Center} from '@chakra-ui/react';

const API_BASE = "https://schedulebackendapi-3an8u.ondigitalocean.app/";
// https://schedulemanagerbackend.onrender.com
interface User {
    full_name: string;
    email: string;
    role?: string;
}

function Home() {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const token = localStorage.getItem('user_token');
        if (!token) {
            console.error('No token found');
            setLoading(false);
            return;
        }

        axios.get(`${API_BASE}/user/get_self`, {
            headers: { Authorization: token },
            withCredentials: true,
        })
            .then((res) => {
                setUser(res.data);
            })
            .catch((err) => {
                console.error('Failed to fetch user', err);
            })
            .finally(() => {
                setLoading(false);
            });
    }, []);

    if (loading) {
        return (
            <Center h="100vh">
                <Spinner size="xl" />
            </Center>
        );
    }

    if (!user) {
        return (
            <Box p={4}>
                <Heading>Error</Heading>
                <Text>Could not load user info.</Text>
            </Box>
        );
    }

    return (
        <Box p={6}>
            <VStack align="center" justify={"center"} spacing={3}>
                <Heading size="lg">Welcome, {user.full_name}</Heading>
                <Text><strong>Email:</strong> {user.email}</Text>
                {user.role && <Text><strong>Role:</strong> {user.role}</Text>}
            </VStack>
        </Box>
    );
}

export default Home;