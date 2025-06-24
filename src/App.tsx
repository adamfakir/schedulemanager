import React from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Home from './pages/Home';
import Subjects from './pages/Subjects';
import Teachers from './pages/Teachers';
import Navbar from './components/Navbar';
import {Box, Flex} from "@chakra-ui/react";
import Students from "./pages/Students";
import ScheduleItem from './pages/ScheduleItem';
//import ProtectedRoute from './routes/ProtectedRoute';
import { AvailabilityProvider } from './utils/AvailabilityContext';

function App() {
    const token = localStorage.getItem('user_token');

    return (
        <Box bg="#f5fff9" minH="100vh"> {/* 👈 background set here */}
            <Router>
                <Routes>
                    <Route path="/login" element={<Login />} />
                    <Route
                        path="/*"
                        element={
                            token ? (
                                <WithNavbar />
                            ) : (
                                <Navigate to="/login" replace />
                            )
                        }
                    />
                </Routes>
            </Router>
        </Box>
    );
}

function WithNavbar() {
    const [sidebarWidth, setSidebarWidth] = React.useState(300); // px, default width

    const handleMouseDown = (e: React.MouseEvent) => {
        const startX = e.clientX;
        const startWidth = sidebarWidth;

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const newWidth = Math.max(200, startWidth + moveEvent.clientX - startX); // min 200px
            setSidebarWidth(newWidth);
        };

        const handleMouseUp = () => {
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
        };

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);
    };

    return (
        <AvailabilityProvider>
            <Flex direction="row" h="100vh">
                {/* Sidebar with resizable handle */}
                <Box w={`${sidebarWidth}px`} position="relative">
                    <Navbar />
                    {/* Resizer handle */}
                    <Box
                        position="absolute"
                        top={0}
                        right={0}
                        width="5px"
                        height="100%"
                        cursor="col-resize"
                        bg="gray.300"
                        onMouseDown={handleMouseDown}
                        _hover={{ bg: "gray.400" }}
                    />
                </Box>

                {/* Main content */}
                <Box ml="0" p={4} flex="1" overflowX="auto">
                    <Routes>
                        <Route path="/home" element={<Home />} />
                        <Route path="/subjects" element={<Subjects />} />
                        <Route path="/teachers" element={<Teachers />} />
                        <Route path="/students" element={<Students />} />
                        <Route path="/schedule/:id" element={<ScheduleItem />} />
                    </Routes>
                </Box>
            </Flex>
        </AvailabilityProvider>
    );
}

export default App;