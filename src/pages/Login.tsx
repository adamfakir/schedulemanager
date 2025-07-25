import React from 'react';
import axios from 'axios';
import {Box, Button, Center, Heading, VStack, Textarea, Input, useToast} from '@chakra-ui/react';
import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
// Inside your component:

// src/Login.tsx
const API_BASE = "https://schedulebackendapi-3an8u.ondigitalocean.app/";
function Login() {
    const toast = useToast();
    let [email, setEmail] = React.useState('')
    let [password, setPassword] = React.useState('')
    const [loading, setLoading] = React.useState(false);
    const navigate = useNavigate();


    useEffect(() => {
        const token = localStorage.getItem("user_token");
        if (!token) return;

        axios.get(`${API_BASE}/user/get_self`, {
            headers: { Authorization: token },
            withCredentials: true,
        })
            .then(() => {
                // Token is valid
                navigate("/home");

            })
            .catch(() => {
                // Invalid token, ignore
                localStorage.removeItem("user_token");
            });
    }, []);
    let handleEmailChange = (e: any) => {
        let inputValue = e.target.value
        setEmail(inputValue)
    }
    let handlePasswordChange = (e: any) => {
        let inputValue = e.target.value
        setPassword(inputValue)
    }

    async function handleLogin() {
        setLoading(true);
        let failed = true;
        try {
        const loginRes = await axios.post(`${API_BASE}/user/login`, {email, password}, {withCredentials: true})
        const token = loginRes.data.token;
        failed = false
        localStorage.setItem("user_token", token);
        navigate("/home");
        window.location.reload();
        } catch (err: any) {
            const message = err?.response?.data?.error || "Login failed. Please try again.";

            toast({
                title: "Login Error",
                description: message,
                status: "error",
                duration: 5000,
                isClosable: true,
            });
        } finally {
            setLoading(false);
            if (!failed) {
                navigate("/home");
            }
        }
    }
    return (
        <Box p={4}>
            <Center h="50vh">
                <VStack spacing={2}>
                    <Heading mb={4}>Schedule Manager Login</Heading>
                    <Textarea placeholder="Email"  resize="none"rows={1} onChange={handleEmailChange}/>
                    <Input
                        placeholder="Password"
                        type="password"
                        onChange={handlePasswordChange}
                    />
                    <Button colorScheme="green" onClick={handleLogin} isLoading={loading} loadingText="Logging in">Login</Button>
                </VStack>

            </Center>

        </Box>
    );
}

export default Login;